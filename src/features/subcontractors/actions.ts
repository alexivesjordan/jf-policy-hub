"use server";

import { revalidatePath } from "next/cache";
import { moduleAllows } from "@/lib/access";
import type { ActionState } from "@/lib/action-state";
import { requireOperationsUser } from "@/lib/auth";
import { messageFromError } from "@/lib/errors";
import { insuranceBytesMatch, insurancePathOk, planInsuranceUpload, readStoredObjectHead, storedInsuranceOk } from "@/lib/pulse/access-upload";
import { pulseStoragePath } from "@/lib/pulse/prepare-upload";
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

/** Same direct-to-storage step as prepareAccessMediaUpload. The file does not pass through Vercel. */
export async function signInsuranceUpload(subcontractorId: string, mimeType: string, byteSize: number): Promise<SignedInsuranceUpload> {
  const profile = await requireOperationsUser();
  if (!moduleAllows(profile, "operations", "edit")) return { ok: false, message: "You cannot add insurance." };
  if (!ID.test(subcontractorId)) return { ok: false, message: "That subcontractor was not found." };
  const plan = planInsuranceUpload(mimeType, byteSize);
  if (!plan.ok) return plan;
  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Supabase is not configured." };
  const path = pulseStoragePath("ops", subcontractorId, plan.extension);
  const signed = await admin.storage.from("insurance").createSignedUploadUrl(path);
  if (signed.error || !signed.data) return { ok: false, message: "Could not start that upload." };
  return {
    ok: true,
    message: "",
    bucket: "insurance",
    path: signed.data.path,
    token: signed.data.token,
    signedUrl: signed.data.signedUrl,
  };
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
  if (!insurancePathOk(input.subcontractorId, input.path)) return { ok: false, message: "That file path is not allowed." };
  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Supabase is not configured." };
  const info = await admin.storage.from("insurance").info(input.path);
  if (info.error || info.data?.size == null || !info.data.contentType) {
    return { ok: false, message: "Upload the file before saving it." };
  }
  const mimeType = info.data.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const plan = storedInsuranceOk(input.path, mimeType, info.data.size);
  if (!plan.ok) {
    await admin.storage.from("insurance").remove([input.path]);
    return plan;
  }
  const head = await insuranceObjectHead(admin, input.path);
  if (!head || !insuranceBytesMatch(mimeType, head)) {
    await admin.storage.from("insurance").remove([input.path]);
    return { ok: false, message: "That file type is not allowed." };
  }
  const registered = await admin.rpc("orbit_register_file", {
    p_bucket: "insurance",
    p_storage_path: input.path,
    p_mime_type: mimeType,
    p_byte_size: info.data.size,
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

async function insuranceObjectHead(admin: NonNullable<ReturnType<typeof createAdminClient>>, path: string) {
  const signed = await admin.storage.from("insurance").createSignedUrl(path, 60);
  if (signed.error || !signed.data?.signedUrl) return null;
  try {
    const response = await fetch(signed.data.signedUrl, {
      headers: { Range: "bytes=0-31" },
      signal: AbortSignal.timeout(10_000),
    });
    return readStoredObjectHead(response);
  } catch {
    return null;
  }
}

function splitList(value: string) {
  return value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
}
