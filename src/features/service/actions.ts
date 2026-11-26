"use server";

import { revalidatePath } from "next/cache";
import { loadCin7ServicePrefill } from "@/lib/cin7/client";
import { cin7IsConnected } from "@/lib/cin7/client";
import { messageFromError } from "@/lib/errors";
import { geocodeUkPostcode } from "@/lib/service/geocode";
import { parseVisitDraft, type VisitDraft } from "@/lib/service/model";
import { storePulseFile } from "@/lib/pulse/files";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";

export type ServiceActionResult = { ok: true; id?: string; message: string } | { ok: false; message: string };

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

export async function saveServiceVisit(id: string | null, draft: VisitDraft): Promise<ServiceActionResult> {
  const parsed = parseVisitDraft(draft);
  if (!parsed.ok) return parsed;
  const postcode = String(parsed.payload.postcode ?? "");
  const coords = await geocodeUkPostcode(postcode);
  if (coords) {
    parsed.payload.latitude = coords.latitude;
    parsed.payload.longitude = coords.longitude;
  }
  const supabase = await createClient();
  const saved = await supabase.rpc("service_visit_save", { p_id: id, p_payload: parsed.payload });
  if (saved.error || !saved.data) {
    return { ok: false, message: messageFromError(saved.error, "That visit could not be saved.") };
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
}): Promise<ServiceActionResult> {
  const supabase = await createClient();
  const moved = await supabase.rpc("service_visit_arrange", {
    p_visit: input.visitId,
    p_from: input.fromResourceId,
    p_to: input.toResourceId,
    p_day: input.day,
    p_index: input.index,
  });
  if (moved.error) return { ok: false, message: messageFromError(moved.error, "That stop could not be moved.") };
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

export async function setServiceProgress(id: string, status: string, note: string, reason: string): Promise<ServiceActionResult> {
  const supabase = await createClient();
  const saved = await supabase.rpc("service_visit_set_progress", {
    p_visit: id,
    p_status: status,
    p_note: note,
    p_reason: reason,
  });
  if (saved.error) return { ok: false, message: messageFromError(saved.error, "That status could not be saved.") };
  refresh(id);
  return { ok: true, message: "Saved." };
}

export async function addServicePhoto(visitId: string, formData: FormData): Promise<ServiceActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "You need to be signed in." };
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a photo." };
  const supabase = await createClient();
  const allowed = await supabase.rpc("service_visit_photo_allowed", { p_visit: visitId });
  if (allowed.error || allowed.data !== true) {
    return { ok: false, message: messageFromError(allowed.error, "You cannot add a photo to that visit.") };
  }
  try {
    const stored = await storePulseFile({
      bucket: "job-sheets",
      mimeType: file.type || "image/jpeg",
      bytes: Buffer.from(await file.arrayBuffer()),
      uploadedBy: profile.id,
      entitySchema: "ops",
      entityTable: "service_visits",
      entityId: visitId,
      kind: "service_photo",
    });
    const linked = await supabase.rpc("service_visit_add_photo", { p_visit: visitId, p_file: stored.fileId });
    if (linked.error) return { ok: false, message: messageFromError(linked.error, "That photo could not be stored.") };
    refresh(visitId);
    return { ok: true, message: "Photo stored." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "That photo could not be stored." };
  }
}
