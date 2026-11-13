"use server";

import { revalidatePath } from "next/cache";
import { moduleAllows } from "@/lib/access";
import type { ActionState } from "@/lib/action-state";
import { requireOperationsUser } from "@/lib/auth";
import { isFixtureMode } from "@/lib/env";
import { messageFromError } from "@/lib/errors";
import { insurancePathFor, planInsuranceUpload, SignedUploadError } from "@/lib/pulse/signed-upload";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const ID = /^[0-9a-f-]{36}$/i;

export type SignedInsuranceUpload = {
  ok: boolean;
  message: string;
  bucket?: "insurance";
  path?: string;
  token?: string;
  signedUrl?: string;
};

export async function saveSubcontractor(_state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireOperationsUser();
  if (!moduleAllows(profile, "operations", "edit")) return { ok: false, message: "You cannot change subcontractors." };
  const id = String(formData.get("id") ?? "").trim();
  if (id && !ID.test(id)) return { ok: false, message: "That subcontractor was not found." };
  const supabase = await createClient();
  const saved = await supabase.rpc("subcontractor_save", {
    p_id: id || null,
    p_row: {
      name: String(formData.get("name") ?? ""),
      contactName: String(formData.get("contactName") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      emails: splitList(String(formData.get("emails") ?? "")),
      regions: splitList(String(formData.get("regions") ?? "")),
      jobTypes: splitList(String(formData.get("jobTypes") ?? "")),
      maxCrew: String(formData.get("maxCrew") ?? ""),
      status: String(formData.get("status") ?? "active"),
      notes: String(formData.get("notes") ?? ""),
    },
  });
  if (saved.error) return { ok: false, message: messageFromError(saved.error, "Could not save that subcontractor.") };
  revalidatePath("/operations/subcontractors");
  return { ok: true, message: id ? "Subcontractor saved." : "Subcontractor added." };
}

export async function removeSubcontractor(id: string): Promise<ActionState> {
  const profile = await requireOperationsUser();
  if (!moduleAllows(profile, "operations", "edit")) return { ok: false, message: "You cannot remove subcontractors." };
  if (!ID.test(id)) return { ok: false, message: "That subcontractor was not found." };
  const supabase = await createClient();
  const removed = await supabase.rpc("subcontractor_remove", { p_id: id });
  if (removed.error) return { ok: false, message: messageFromError(removed.error, "Could not remove that subcontractor.") };
  revalidatePath("/operations/subcontractors");
  return { ok: true, message: "Subcontractor removed." };
}

/** Signed URL so the browser uploads straight to storage and skips the Vercel body limit. */
export async function signInsuranceUpload(subcontractorId: string, mimeType: string, byteSize: number): Promise<SignedInsuranceUpload> {
  const profile = await requireOperationsUser();
  if (!moduleAllows(profile, "operations", "edit")) return { ok: false, message: "You cannot add insurance." };
  try {
    const plan = planInsuranceUpload({ entityId: subcontractorId, mimeType, byteSize });
    if (isFixtureMode()) return { ok: true, message: "", bucket: "insurance", path: plan.path, token: "fixture", signedUrl: "" };
    const admin = createAdminClient();
    if (!admin) return { ok: false, message: "Supabase is not configured." };
    const signed = await admin.storage.from(plan.bucket).createSignedUploadUrl(plan.path);
    if (signed.error || !signed.data?.token) return { ok: false, message: "Could not prepare that upload." };
    return {
      ok: true,
      message: "",
      bucket: "insurance",
      path: signed.data.path || plan.path,
      token: signed.data.token,
      signedUrl: signed.data.signedUrl,
    };
  } catch (error) {
    if (error instanceof SignedUploadError) return { ok: false, message: error.message };
    return { ok: false, message: "Could not prepare that upload." };
  }
}

export async function completeInsuranceUpload(input: {
  subcontractorId: string;
  path: string;
  mimeType: string;
  byteSize: number;
  expiresOn: string;
  label: string;
}): Promise<ActionState> {
  const profile = await requireOperationsUser();
  if (!moduleAllows(profile, "operations", "edit")) return { ok: false, message: "You cannot add insurance." };
  if (!ID.test(input.subcontractorId)) return { ok: false, message: "That subcontractor was not found." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiresOn)) return { ok: false, message: "Enter an expiry date." };
  if (!insurancePathFor(input.subcontractorId, input.path)) return { ok: false, message: "That file path is not allowed." };
  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Supabase is not configured." };
  if (!isFixtureMode()) {
    const folder = input.path.slice(0, input.path.lastIndexOf("/"));
    const name = input.path.slice(input.path.lastIndexOf("/") + 1);
    const listed = await admin.storage.from("insurance").list(folder);
    const found = listed.data?.some((item) => item.name === name);
    if (listed.error || !found) return { ok: false, message: "That file did not arrive." };
  }
  const registered = await admin.rpc("orbit_register_file", {
    p_bucket: "insurance",
    p_storage_path: input.path,
    p_mime_type: input.mimeType,
    p_byte_size: input.byteSize,
    p_checksum: null,
    p_uploaded_by: profile.id,
    p_entity_schema: "ops",
    p_entity_table: "subcontractors",
    p_entity_id: input.subcontractorId,
    p_kind: "insurance",
  });
  if (registered.error || !registered.data) return { ok: false, message: messageFromError(registered.error, "Could not register that document.") };
  const supabase = await createClient();
  const saved = await supabase.rpc("subcontractor_attach_insurance", {
    p_subcontractor: input.subcontractorId,
    p_file: registered.data,
    p_expires: input.expiresOn,
    p_label: input.label,
  });
  if (saved.error) return { ok: false, message: messageFromError(saved.error, "Could not attach that document.") };
  revalidatePath("/operations/subcontractors");
  revalidatePath(`/operations/subcontractors/${input.subcontractorId}`);
  return { ok: true, message: "Insurance document added." };
}

export async function dropInsurance(subcontractorId: string, documentId: string): Promise<ActionState> {
  const profile = await requireOperationsUser();
  if (!moduleAllows(profile, "operations", "edit")) return { ok: false, message: "You cannot remove insurance." };
  if (!ID.test(subcontractorId) || !ID.test(documentId)) return { ok: false, message: "That document was not found." };
  const supabase = await createClient();
  const dropped = await supabase.rpc("subcontractor_drop_insurance", { p_id: documentId });
  if (dropped.error) return { ok: false, message: messageFromError(dropped.error, "Could not remove that document.") };
  revalidatePath(`/operations/subcontractors/${subcontractorId}`);
  return { ok: true, message: "Insurance document removed." };
}

function splitList(value: string) {
  return value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
}
