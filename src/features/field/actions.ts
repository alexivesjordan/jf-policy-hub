"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth";
import { messageFromError } from "@/lib/errors";
import { DOCUMENT_LABELS, VISIT_DOCUMENTS, type VisitDocumentKey } from "@/lib/installs/product-lines";
import type { StorageTicket } from "@/lib/installs/upload-ticket";
import type { RiskAnswers, SheetDraft } from "@/lib/installs/visit-form";
import { storePulseFile } from "@/lib/pulse/files";
import { issueDocumentTicket, issuePhotoTicket, registerDocumentObject, registerPhotoObject } from "@/lib/pulse/signed-upload";
import { createTokenLink } from "@/lib/pulse/tokens";
import { createClient } from "@/lib/supabase/server";
import { commitVisit, gateVisitUpload, presentedToken, saveRiskForVisit } from "@/features/field/submit";
import { prepareSignaturePng } from "@/lib/installs/signature-image";

export type FieldResult = { ok: boolean; message: string; path?: string; ticket?: StorageTicket; fileId?: string };

function fileOf(formData: FormData, name: string) {
  const file = formData.get(name);
  return file instanceof File && file.size > 0 ? file : null;
}

function revalidateVisit(installId: string) {
  revalidatePath("/field");
  revalidatePath(`/field/${installId}`);
  revalidatePath("/operations/installs");
  revalidatePath("/sales/installs");
}

async function actor(token: string | null) {
  if (token) {
    presentedToken(token);
    return null;
  }
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("You need to be signed in.");
  return profile;
}

export async function issuePhotoUpload(installId: string, token: string | null, mimeType: string, byteSize: number, kind: string): Promise<FieldResult> {
  try {
    await actor(token);
    await gateVisitUpload(installId, token, kind);
    const ticket = await issuePhotoTicket(installId, mimeType, byteSize);
    return { ok: true, message: "Upload ready.", ticket };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not start that upload." };
  }
}

export async function registerPhotoUpload(installId: string, token: string | null, path: string, kind: string): Promise<FieldResult> {
  try {
    const profile = await actor(token);
    await gateVisitUpload(installId, token, kind);
    const stored = await registerPhotoObject({
      path,
      ownerId: installId,
      kind,
      uploadedBy: profile?.id ?? null,
    });
    return { ok: true, message: "Photo stored.", fileId: stored.fileId };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not store that photo." };
  }
}

export async function saveVisitRisk(installId: string, token: string | null, answers: RiskAnswers, concernFileIds: string[]): Promise<FieldResult> {
  try {
    await actor(token);
    await saveRiskForVisit({ installId, token, answers, concernFileIds });
    if (!token) revalidateVisit(installId);
    return { ok: true, message: "Risk assessment saved." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not save the risk assessment." };
  }
}

export async function submitVisit(formData: FormData): Promise<FieldResult> {
  const installId = String(formData.get("installId") ?? "");
  const token = String(formData.get("token") ?? "") || null;
  try {
    const profile = await actor(token);
    const sheet = JSON.parse(String(formData.get("sheet") ?? "")) as SheetDraft;
    const photoIds = JSON.parse(String(formData.get("photoIds") ?? "[]")) as string[];
    const customer = fileOf(formData, "customerSignature");
    if (!customer) return { ok: false, message: "Add the customer signature." };
    const result = await commitVisit({
      installId,
      token,
      sheet,
      photoIds: Array.isArray(photoIds) ? photoIds : [],
      engineerSignature: fileOf(formData, "engineerSignature"),
      engineerSignatureFileId: String(formData.get("engineerSignatureFileId") ?? "") || null,
      customerSignature: customer,
      saveEngineerSignature: formData.get("saveSignature") === "yes",
      uploadedBy: profile?.id ?? null,
    });
    if (!token) revalidateVisit(installId);
    return { ok: true, message: result.message };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the job sheet.";
    if (message.includes("already in")) return { ok: true, message: "This job sheet is already in." };
    return { ok: false, message };
  }
}

export async function saveStaffSignature(formData: FormData): Promise<FieldResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "You need to be signed in." };
  const file = fileOf(formData, "signature");
  if (!file) return { ok: false, message: "Draw your signature." };
  try {
    const bytes = await prepareSignaturePng(new Uint8Array(await file.arrayBuffer()));
    const stored = await storePulseFile({
      bucket: "job-sheets",
      mimeType: "image/png",
      bytes: Buffer.from(bytes),
      uploadedBy: profile.id,
      entitySchema: "ops",
      entityTable: "staff_signatures",
      entityId: profile.id,
      kind: "staff_signature",
    });
    const supabase = await createClient();
    const saved = await supabase.rpc("install_save_staff_signature", { p_file_id: stored.fileId });
    if (saved.error) return { ok: false, message: messageFromError(saved.error, "Could not save your signature.") };
    revalidatePath("/field/signature");
    return { ok: true, message: "Signature saved." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not save your signature." };
  }
}

export async function issueDocumentUpload(byteSize: number): Promise<FieldResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "You need to be signed in." };
  try {
    const supabase = await createClient();
    const allowed = await supabase.rpc("install_sees_all");
    if (allowed.error || allowed.data !== true) return { ok: false, message: "You cannot update those documents." };
    const ticket = await issueDocumentTicket(profile.id, byteSize);
    return { ok: true, message: "Upload ready.", ticket };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not start that upload." };
  }
}

export async function registerDocumentUpload(key: VisitDocumentKey, path: string): Promise<FieldResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "You need to be signed in." };
  if (!VISIT_DOCUMENTS.includes(key)) return { ok: false, message: "That document is not on the list." };
  try {
    const stored = await registerDocumentObject({
      path,
      ownerId: profile.id,
      kind: key,
      uploadedBy: profile.id,
    });
    const supabase = await createClient();
    const saved = await supabase.rpc("install_save_visit_document", { p_key: key, p_file_id: stored.fileId });
    if (saved.error) return { ok: false, message: messageFromError(saved.error, "Could not save that document.") };
    revalidatePath("/operations/documents");
    return { ok: true, message: `${DOCUMENT_LABELS[key]} saved.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not save that document." };
  }
}

export async function createSubcontractorLink(installId: string): Promise<FieldResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "You need to be signed in." };
  try {
    const supabase = await createClient();
    const allowed = await supabase.rpc("install_sees_all");
    if (allowed.error || allowed.data !== true) return { ok: false, message: "You cannot create that link." };
    const link = await createTokenLink({
      purpose: "subcontractor_job",
      entitySchema: "ops",
      entityTable: "installs",
      entityId: installId,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString(),
    });
    return { ok: true, message: "Link ready. It is shown once.", path: `/visit/${link.token}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not create the link." };
  }
}
