"use server";

import { revalidatePath } from "next/cache";
import { loadCin7ServicePrefill } from "@/lib/cin7/client";
import { cin7IsConnected } from "@/lib/cin7/client";
import { commitServiceVisit } from "@/features/service/commit-sheet";
import { getCurrentProfile } from "@/lib/auth";
import { messageFromError } from "@/lib/errors";
import type { StorageTicket } from "@/lib/installs/upload-ticket";
import type { SheetDraft } from "@/lib/installs/visit-form";
import { issuePhotoTicket, registerPhotoObject } from "@/lib/pulse/signed-upload";
import { geocodeUkPostcode } from "@/lib/service/geocode";
import { parseVisitDraft, type VisitDraft } from "@/lib/service/model";
import { createClient } from "@/lib/supabase/server";

export type ServiceActionResult =
  | { ok: true; id?: string; message: string }
  | { ok: false; overlap?: boolean; message: string };

function fromRpc(error: { message?: string; details?: string } | null, fallback: string): ServiceActionResult {
  const message = messageFromError(error, fallback);
  if (message.startsWith("These times overlap")) return { ok: false, overlap: true, message };
  return { ok: false, message };
}

function refresh(id?: string) {
  revalidatePath("/service");
  revalidatePath("/service/day");
  if (id) {
    revalidatePath(`/service/visits/${id}`);
    revalidatePath(`/service/day/${id}`);
  }
}

export async function lookupServiceOrder(orderNumber: string) {
  const lookup = orderNumber.trim();
  if (!lookup) return { ok: false as const, message: "Enter the Cin7 order number." };
  if (!cin7IsConnected()) return { ok: false as const, message: "Cin7 is not connected." };
  try {
    const prefill = await loadCin7ServicePrefill(lookup);
    if (!prefill || !prefill.customerName && !prefill.addressLine1) {
      return { ok: false as const, message: "No sale with that order number." };
    }
    return { ok: true as const, prefill };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "Cin7 could not be read." };
  }
}

export async function saveServiceVisit(id: string | null, draft: VisitDraft, confirmOverlap = false): Promise<ServiceActionResult> {
  const parsed = parseVisitDraft(draft);
  if (!parsed.ok) return parsed;
  const postcode = String(parsed.payload.postcode ?? "");
  const coords = await geocodeUkPostcode(postcode);
  if (coords) {
    parsed.payload.latitude = coords.latitude;
    parsed.payload.longitude = coords.longitude;
  }
  if (confirmOverlap) parsed.payload.confirmOverlap = true;
  const supabase = await createClient();
  const saved = await supabase.rpc("service_visit_save", { p_id: id, p_payload: parsed.payload });
  if (saved.error || !saved.data) {
    return fromRpc(saved.error, "That visit could not be saved.");
  }
  const visitId = String(saved.data);
  refresh(visitId);
  return { ok: true, id: visitId, message: "Saved." };
}

export async function arrangeServiceVisit(input: {
  visitId: string;
  fromResourceId: string | null;
  toResourceId: string | null;
  day: string;
  index: number;
  confirmOverlap?: boolean;
}): Promise<ServiceActionResult> {
  const supabase = await createClient();
  const moved = await supabase.rpc("service_visit_arrange", {
    p_visit: input.visitId,
    p_from: input.fromResourceId,
    p_to: input.toResourceId,
    p_day: input.day,
    p_index: input.index,
    p_confirm: input.confirmOverlap === true,
  });
  if (moved.error) return fromRpc(moved.error, "That stop could not be moved.");
  refresh(input.visitId);
  return { ok: true, message: "Moved." };
}

export async function deleteServiceVisit(id: string): Promise<ServiceActionResult> {
  const supabase = await createClient();
  const removed = await supabase.rpc("service_visit_delete", { p_visit: id });
  if (removed.error) return { ok: false, message: messageFromError(removed.error, "That visit could not be deleted.") };
  refresh(id);
  return { ok: true, message: "Deleted." };
}

export async function setServiceProgress(id: string, status: string, reason: string): Promise<ServiceActionResult> {
  const supabase = await createClient();
  const saved = await supabase.rpc("service_visit_set_progress", {
    p_visit: id,
    p_status: status,
    p_note: null,
    p_reason: reason,
  });
  if (saved.error) return { ok: false, message: messageFromError(saved.error, "That status could not be saved.") };
  refresh(id);
  return { ok: true, message: "Saved." };
}

export type ServiceUploadResult = {
  ok: boolean;
  message: string;
  ticket?: StorageTicket;
  fileId?: string;
};

function fileOf(formData: FormData, name: string) {
  const file = formData.get(name);
  return file instanceof File && file.size > 0 ? file : null;
}

export async function issueServicePhotoUpload(
  visitId: string,
  _token: string | null,
  mimeType: string,
  byteSize: number,
  kind: string,
): Promise<ServiceUploadResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "You need to be signed in." };
    const supabase = await createClient();
    const gated = await supabase.rpc("service_visit_upload_gate", { p_visit: visitId, p_kind: kind });
    if (gated.error) return { ok: false, message: messageFromError(gated.error, "That photo is not allowed.") };
    const ticket = await issuePhotoTicket(visitId, mimeType, byteSize);
    return { ok: true, message: "Upload ready.", ticket };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not start that upload." };
  }
}

export async function registerServicePhotoUpload(
  visitId: string,
  _token: string | null,
  path: string,
  kind: string,
): Promise<ServiceUploadResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "You need to be signed in." };
    const supabase = await createClient();
    const gated = await supabase.rpc("service_visit_upload_gate", { p_visit: visitId, p_kind: kind });
    if (gated.error) return { ok: false, message: messageFromError(gated.error, "That photo is not allowed.") };
    const stored = await registerPhotoObject({
      path,
      ownerId: visitId,
      kind,
      uploadedBy: profile.id,
      entityTable: "service_visits",
    });
    return { ok: true, message: "Photo stored.", fileId: stored.fileId };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not store that photo." };
  }
}

export async function submitServiceVisit(formData: FormData): Promise<ServiceActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "You need to be signed in." };
  const visitId = String(formData.get("installId") ?? "");
  try {
    const sheet = JSON.parse(String(formData.get("sheet") ?? "")) as SheetDraft;
    const photoIds = JSON.parse(String(formData.get("photoIds") ?? "[]")) as string[];
    const customer = fileOf(formData, "customerSignature");
    if (!customer) return { ok: false, message: "Add the customer signature." };
    const result = await commitServiceVisit({
      visitId,
      sheet,
      photoIds: Array.isArray(photoIds) ? photoIds : [],
      engineerSignature: fileOf(formData, "engineerSignature"),
      engineerSignatureFileId: String(formData.get("engineerSignatureFileId") ?? "") || null,
      customerSignature: customer,
      saveEngineerSignature: formData.get("saveSignature") === "yes",
      uploadedBy: profile.id,
    });
    refresh(visitId);
    return { ok: true, message: result.message };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the job sheet.";
    if (message.includes("already in")) return { ok: true, message: "This job sheet is already in." };
    return { ok: false, message };
  }
}
