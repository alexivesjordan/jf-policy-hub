import "server-only";

import { asVisitContext, type VisitContext } from "@/features/field/queries";
import { deliverPulseEmail } from "@/lib/email/deliver";
import { messageFromError } from "@/lib/errors";
import { DOCUMENT_FILENAMES, documentsForOrder, selectStoredDocuments, type OrderLine, type VisitDocumentKey } from "@/lib/installs/product-lines";
import { RISK_ITEMS, sheetPayload, validateRisk, validateSheet, vehicleChoiceProblem, type RiskAnswers, type SheetDraft } from "@/lib/installs/visit-form";
import { prepareSignaturePng } from "@/lib/installs/signature-image";
import { buildVisitPdf } from "@/lib/installs/visit-pdf";
import { storePulseFile } from "@/lib/pulse/files";
import { downloadStorageObject } from "@/lib/pulse/signed-upload";
import { hashPulseToken } from "@/lib/pulse/token-hash";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RpcError = { message?: string };
type FileRef = { id?: string; bucket: string; path: string; key?: VisitDocumentKey };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function adminOrThrow() {
  const admin = createAdminClient();
  if (!admin) throw new Error("Supabase is not configured.");
  return admin;
}

export function presentedToken(token: string | null) {
  if (!token) return null;
  const hash = hashPulseToken(token);
  if (!hash) throw new Error("That link is not valid.");
  return hash;
}

async function callRpc(token: string | null, fn: string, args: Record<string, unknown>) {
  if (token) {
    const { data, error } = await adminOrThrow().rpc(fn, args);
    if (error) throw new Error(messageFromError(error as RpcError, "Could not save the job."));
    return data;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(messageFromError(error as RpcError, "Could not save the job."));
  return data;
}

export async function loadVisit(installId: string, token: string | null) {
  if (!UUID.test(installId)) throw new Error("That job was not found.");
  const data = token
    ? await callRpc(token, "install_visit_preview", { p_token_hash: presentedToken(token) })
    : await callRpc(null, "install_visit_context", { p_install: installId });
  const visit = asVisitContext(data);
  if (!visit || visit.job.id !== installId) throw new Error("You cannot open that job.");
  return visit;
}

const PHOTO_KINDS = new Set(["concern", "equipment"]);

export async function gateVisitUpload(installId: string, token: string | null, kind: string) {
  if (!PHOTO_KINDS.has(kind)) throw new Error("That photo is not allowed.");
  await callRpc(token, "install_visit_upload_gate", {
    p_install: installId,
    p_token_hash: presentedToken(token),
    p_kind: kind,
  });
}

export async function saveRiskForVisit(input: { installId: string; token: string | null; answers: RiskAnswers; concernFileIds: string[] }) {
  const problem = validateRisk(input.answers);
  if (problem) throw new Error(problem);
  const ids = input.concernFileIds.filter((id) => UUID.test(id)).slice(0, 6);
  await callRpc(input.token, "install_save_visit_risk", {
    p_install: input.installId,
    p_answers: input.answers,
    p_concern_file_ids: ids,
    p_token_hash: presentedToken(input.token),
  });
}

async function logEmail(input: { to: string; subject: string; template: string; installId: string; detail: string }) {
  await adminOrThrow().rpc("email_record", {
    p_to: input.to,
    p_subject: input.subject,
    p_template: input.template,
    p_install: input.installId,
    p_provider_id: null,
    p_status: "logged",
    p_detail: input.detail,
    p_token_link: null,
    p_access_path: null,
  });
}

function safePdfName(orderNumber: string) {
  const clean = orderNumber.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "job";
  return `Jordan-Fitness-job-sheet-${clean}.pdf`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}

async function filesFor(token: string | null, installId: string, ids: string[]) {
  const rows = (await callRpc(token, "install_owned_files", {
    p_install: installId,
    p_ids: ids,
    p_token_hash: presentedToken(token),
  })) as FileRef[] | null;
  return rows ?? [];
}

export async function commitVisit(input: {
  installId: string;
  token: string | null;
  sheet: SheetDraft;
  photoIds: string[];
  engineerSignature: File | null;
  engineerSignatureFileId: string | null;
  customerSignature: File;
  saveEngineerSignature: boolean;
  uploadedBy: string | null;
}) {
  const problem = validateSheet(input.sheet);
  if (problem) throw new Error(problem);
  const vans = (await callRpc(input.token, "install_list_vans", {})) as { registration?: string }[] | null;
  const vehicle = vehicleChoiceProblem(
    input.sheet.vehicleReg.trim(),
    Array.isArray(vans) ? vans.flatMap((van) => (van?.registration ? [{ registration: van.registration }] : [])) : [],
  );
  if (vehicle) throw new Error(vehicle);
  if (input.sheet.parkingFee.trim() && !/^[0-9]+(\.[0-9]{1,2})?$/.test(input.sheet.parkingFee.trim())) {
    throw new Error("Enter the parking fee in pounds.");
  }
  const photoIds = input.photoIds.filter((id) => UUID.test(id)).slice(0, 8);
  if (photoIds.length < 1) throw new Error("Add a photo of the equipment.");
  const visit = await loadVisit(input.installId, input.token);
  if (visit.submitted || visit.job.status === "cancelled") throw new Error("This job sheet is already in.");
  if (!visit.risk) throw new Error("Save the risk assessment before the job sheet.");

  let engineerFileId = input.engineerSignatureFileId;
  let engineerBytes: Uint8Array | null = null;
  if (input.engineerSignature) {
    engineerBytes = await prepareSignaturePng(new Uint8Array(await input.engineerSignature.arrayBuffer()));
    const stored = await storePulseFile({
      bucket: "job-sheets",
      mimeType: "image/png",
      bytes: Buffer.from(engineerBytes),
      uploadedBy: input.uploadedBy,
      entitySchema: "ops",
      entityTable: "installs",
      entityId: input.installId,
      kind: "engineer_signature",
    });
    engineerFileId = stored.fileId;
    if (input.saveEngineerSignature && !input.token && input.uploadedBy) {
      const supabase = await createClient();
      const saved = await supabase.rpc("install_save_staff_signature", { p_file_id: stored.fileId });
      if (saved.error) throw new Error(messageFromError(saved.error as RpcError, "Could not save your signature."));
    }
  } else if (!input.token && engineerFileId) {
    const supabase = await createClient();
    const mine = await supabase.rpc("install_my_signature");
    const row = mine.data as { fileId?: string; bucket?: string; path?: string } | null;
    if (mine.error || row?.fileId !== engineerFileId || !row.bucket || !row.path) throw new Error("Draw your signature.");
    const saved = await downloadStorageObject(row.bucket, row.path);
    if (!saved) throw new Error("Draw your signature.");
    engineerBytes = await prepareSignaturePng(saved);
  } else {
    throw new Error("Draw your signature.");
  }
  if (!engineerFileId || !engineerBytes) throw new Error("Draw your signature.");

  const customerBytes = await prepareSignaturePng(new Uint8Array(await input.customerSignature.arrayBuffer()));
  const customer = await storePulseFile({
    bucket: "job-sheets",
    mimeType: "image/png",
    bytes: Buffer.from(customerBytes),
    uploadedBy: input.uploadedBy,
    entitySchema: "ops",
    entityTable: "installs",
    entityId: input.installId,
    kind: "customer_signature",
  });

  const photos: { label: string; bytes: Uint8Array }[] = [];
  const owned = await filesFor(input.token, input.installId, photoIds);
  if (owned.length !== photoIds.length) throw new Error("That photo is not on this job.");
  for (const [index, file] of owned.entries()) {
    const bytes = await downloadStorageObject(file.bucket, file.path);
    if (bytes) photos.push({ label: `Equipment ${index + 1}`, bytes });
  }
  const concerns = (await callRpc(input.token, "install_concern_files", {
    p_install: input.installId,
    p_token_hash: presentedToken(input.token),
  })) as FileRef[] | null;
  for (const [index, file] of (concerns ?? []).entries()) {
    const bytes = await downloadStorageObject(file.bucket, file.path);
    if (bytes) photos.push({ label: `Concern ${index + 1}`, bytes });
  }

  const pdf = await buildVisitPdf({
    sheet: input.sheet,
    riskLines: RISK_ITEMS.map((item) => ({
      label: item.label,
      answer: visit.risk?.[item.key] === true ? "Yes" : visit.risk?.[item.key] === false ? "No" : "-",
    })),
    riskNotes: visit.risk?.notes ?? "",
    engineerSignature: engineerBytes,
    customerSignature: customerBytes,
    photos,
  });
  const pdfFile = await storePulseFile({
    bucket: "job-sheets",
    mimeType: "application/pdf",
    bytes: Buffer.from(pdf),
    uploadedBy: input.uploadedBy,
    entitySchema: "ops",
    entityTable: "installs",
    entityId: input.installId,
    kind: "visit_pack",
  });
  const committed = (await callRpc(input.token, "install_commit_visit", {
    p_install: input.installId,
    p_sheet: sheetPayload(input.sheet, {
      engineerSignatureFileId: engineerFileId,
      customerSignatureFileId: customer.fileId,
      pdfFileId: pdfFile.fileId,
    }),
    p_photo_ids: photoIds,
    p_token_hash: presentedToken(input.token),
  })) as { contactEmail?: string | null; orderNumber?: string; customerName?: string; lines?: OrderLine[] };

  const orderNumber = committed.orderNumber || input.sheet.orderNo || "job";
  const customerName = committed.customerName || input.sheet.customerName;
  const email = committed.contactEmail?.trim() ?? "";
  const lines = Array.isArray(committed.lines) && committed.lines.length > 0 ? committed.lines : visit.lines;
  const stored = (await callRpc(input.token, "install_list_visit_documents", {})) as { key: VisitDocumentKey; bucket: string; path: string }[] | null;
  const selection = selectStoredDocuments(documentsForOrder(lines), (stored ?? []).map((file) => file.key));
  const attachments = [{ filename: safePdfName(orderNumber), contentBase64: Buffer.from(pdf).toString("base64") }];
  const skipped = [...selection.skipped];
  for (const key of selection.attach) {
    const file = (stored ?? []).find((item) => item.key === key);
    const bytes = file ? await downloadStorageObject(file.bucket, file.path) : null;
    if (!file || !bytes) {
      skipped.push(key);
      continue;
    }
    attachments.push({ filename: DOCUMENT_FILENAMES[key], contentBase64: Buffer.from(bytes).toString("base64") });
  }

  let note = "Job sheet saved.";
  if (!email) {
    await logEmail({ to: "missing", subject: `Job sheet ${orderNumber}`, template: "visit_pack", installId: input.installId, detail: "No customer email on the install" });
    note = "Saved. There is no customer email, so the pack was not sent.";
  } else {
    const sent = await deliverPulseEmail({
      to: email,
      subject: `Jordan Fitness job sheet ${orderNumber}`,
      template: "visit_pack",
      installId: input.installId,
      text: `The job sheet for ${customerName} (${orderNumber}) is attached.`,
      html: `<p>The job sheet for ${escapeHtml(customerName)} (${escapeHtml(orderNumber)}) is attached.</p>`,
      attachments,
    });
    if (sent.status === "failed") note = "Saved. The email did not send.";
    else if (sent.status === "logged") note = "Saved. Email is logged until Resend is configured.";
    else note = "Saved and emailed.";
  }
  if (skipped.length > 0) {
    await logEmail({
      to: email || "missing",
      subject: `Job sheet documents ${orderNumber}`,
      template: "visit_pack_missing_docs",
      installId: input.installId,
      detail: `Missing: ${[...new Set(skipped)].join(", ")}`,
    });
    note = `${note} Some guides are not uploaded yet.`;
  }
  return { message: note };
}

export type { VisitContext };
