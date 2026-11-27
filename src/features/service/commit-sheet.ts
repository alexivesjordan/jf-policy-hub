import "server-only";

import { deliverPulseEmail } from "@/lib/email/deliver";
import { messageFromError } from "@/lib/errors";
import { prepareSignaturePng } from "@/lib/installs/signature-image";
import { sheetPayload, validateSheet, vehicleChoiceProblem, type SheetDraft } from "@/lib/installs/visit-form";
import { buildVisitPdf } from "@/lib/installs/visit-pdf";
import { storePulseFile } from "@/lib/pulse/files";
import { downloadStorageObject } from "@/lib/pulse/signed-upload";
import { createClient } from "@/lib/supabase/server";

type RpcError = { message?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function pdfName(order: string) {
  const clean = order.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "service-visit";
  return `${clean}.pdf`;
}

export async function commitServiceVisit(input: {
  visitId: string;
  sheet: SheetDraft;
  photoIds: string[];
  engineerSignature: File | null;
  engineerSignatureFileId: string | null;
  customerSignature: File;
  saveEngineerSignature: boolean;
  uploadedBy: string | null;
}) {
  const sheet: SheetDraft = { ...input.sheet, visitType: "service" };
  const problem = validateSheet(sheet);
  if (problem) throw new Error(problem);
  const supabase = await createClient();
  const vans = await supabase.rpc("install_list_vans");
  if (vans.error) throw new Error(messageFromError(vans.error as RpcError, "Could not load the vans."));
  const vehicle = vehicleChoiceProblem(
    sheet.vehicleReg.trim(),
    Array.isArray(vans.data) ? vans.data.flatMap((van) => {
      const row = van as { registration?: string };
      return row?.registration ? [{ registration: row.registration }] : [];
    }) : [],
  );
  if (vehicle) throw new Error(vehicle);
  if (sheet.parkingFee.trim() && !/^[0-9]+(\.[0-9]{1,2})?$/.test(sheet.parkingFee.trim())) {
    throw new Error("Enter the parking fee in pounds.");
  }
  const photoIds = input.photoIds.filter((id) => UUID.test(id)).slice(0, 8);
  if (photoIds.length < 1) throw new Error("Add a photo of the equipment.");

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
      entityTable: "service_visits",
      entityId: input.visitId,
      kind: "engineer_signature",
    });
    engineerFileId = stored.fileId;
    if (input.saveEngineerSignature && input.uploadedBy) {
      const saved = await supabase.rpc("install_save_staff_signature", { p_file_id: stored.fileId });
      if (saved.error) throw new Error(messageFromError(saved.error as RpcError, "Could not save your signature."));
    }
  } else if (engineerFileId) {
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
    entityTable: "service_visits",
    entityId: input.visitId,
    kind: "customer_signature",
  });
  const pdf = await buildVisitPdf({
    sheet,
    riskLines: [],
    riskNotes: "",
    engineerSignature: engineerBytes,
    customerSignature: customerBytes,
  });
  const pdfFile = await storePulseFile({
    bucket: "job-sheets",
    mimeType: "application/pdf",
    bytes: Buffer.from(pdf),
    uploadedBy: input.uploadedBy,
    entitySchema: "ops",
    entityTable: "service_visits",
    entityId: input.visitId,
    kind: "visit_pack",
  });
  const committed = await supabase.rpc("service_save_visit_sheet", {
    p_visit: input.visitId,
    p_sheet: sheetPayload(sheet, {
      engineerSignatureFileId: engineerFileId,
      customerSignatureFileId: customer.fileId,
      pdfFileId: pdfFile.fileId,
    }),
    p_photo_ids: photoIds,
  });
  if (committed.error) throw new Error(messageFromError(committed.error as RpcError, "Could not save the job sheet."));
  const rolled = await supabase.rpc("svc_advance_plan", { p_visit: input.visitId });
  if (rolled.error) throw new Error(messageFromError(rolled.error as RpcError, "The maintenance date could not be moved."));
  const saved = (committed.data ?? {}) as { contactEmail?: string | null; customerName?: string; orderNumber?: string };
  const orderNumber = saved.orderNumber || sheet.orderNo || "service visit";
  const customerName = saved.customerName || sheet.customerName;
  const email = saved.contactEmail?.trim() ?? "";
  let note = "Job sheet saved.";
  if (!email) {
    note = "Saved. There is no customer email, so the sheet was not sent.";
  } else {
    try {
      const sent = await deliverPulseEmail({
        to: email,
        subject: `Jordan Fitness service visit ${orderNumber}`,
        template: "visit_pack",
        installId: null,
        text: `The service visit sheet for ${customerName} (${orderNumber}) is attached.`,
        html: `<p>The service visit sheet for ${escapeHtml(customerName)} (${escapeHtml(orderNumber)}) is attached.</p>`,
        attachments: [{ filename: pdfName(orderNumber), contentBase64: Buffer.from(pdf).toString("base64") }],
      });
      if (sent.status === "failed") note = "Saved. The email did not send.";
      else if (sent.status === "logged") note = "Saved. Email is logged until Resend is configured.";
      else note = "Saved and emailed.";
    } catch {
      note = "Saved. The email did not send.";
    }
  }
  return { message: note };
}
