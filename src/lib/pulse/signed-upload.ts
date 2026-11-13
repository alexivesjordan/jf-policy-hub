import "server-only";

import { accessMediaPathOk, planAccessMediaUpload } from "@/lib/pulse/access-upload";
import { pulseStoragePath } from "@/lib/pulse/prepare-upload";
import { pathBelongsToInstall } from "@/lib/installs/permissions";
import type { StorageTicket } from "@/lib/installs/upload-ticket";
import { createAdminClient } from "@/lib/supabase/admin";

export type { StorageTicket };

const PDF_LIMIT = 20 * 1024 * 1024;

function adminOrThrow() {
  const admin = createAdminClient();
  if (!admin) throw new Error("Supabase is not configured.");
  return admin;
}

async function signTicket(bucket: StorageTicket["bucket"], ownerId: string, extension: string): Promise<StorageTicket> {
  const path = pulseStoragePath("ops", ownerId, extension);
  const signed = await adminOrThrow().storage.from(bucket).createSignedUploadUrl(path);
  if (signed.error || !signed.data?.token || !signed.data.signedUrl) throw new Error("Could not start that upload.");
  return { bucket, path: signed.data.path, token: signed.data.token, signedUrl: signed.data.signedUrl };
}

/** Same signed-upload ticket as access media. Photos only: the phone already compressed them. */
export async function issuePhotoTicket(ownerId: string, mimeType: string, byteSize: number) {
  const plan = planAccessMediaUpload(mimeType, byteSize);
  if (!plan.ok) throw new Error(plan.message);
  if (plan.kind !== "photo") throw new Error("Use a photo.");
  return signTicket("job-sheets", ownerId, plan.extension);
}

/** Confirms the object landed, then registers it. The bytes stay in Storage. */
export async function registerPhotoObject(input: {
  path: string;
  ownerId: string;
  mimeType: string;
  byteSize: number;
  kind: string;
  uploadedBy: string | null;
}) {
  const plan = planAccessMediaUpload(input.mimeType, input.byteSize);
  if (!plan.ok) throw new Error(plan.message);
  if (plan.kind !== "photo") throw new Error("Use a photo.");
  if (!accessMediaPathOk(input.ownerId, input.path) || !input.path.endsWith(`.${plan.extension}`)) {
    throw new Error("That file path is not allowed.");
  }
  return registerListedObject({
    bucket: "job-sheets",
    path: input.path,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    kind: input.kind,
    uploadedBy: input.uploadedBy,
    entityTable: "installs",
    ownerId: input.ownerId,
  });
}

export async function issueDocumentTicket(ownerId: string, byteSize: number) {
  if (byteSize <= 0 || byteSize > PDF_LIMIT) throw new Error("PDFs must be 20 MB or smaller.");
  return signTicket("documents", ownerId, "pdf");
}

export async function registerDocumentObject(input: { path: string; ownerId: string; byteSize: number; kind: string; uploadedBy: string | null }) {
  if (input.byteSize <= 0 || input.byteSize > PDF_LIMIT) throw new Error("PDFs must be 20 MB or smaller.");
  if (!pathBelongsToInstall(input.ownerId, input.path) || !input.path.endsWith(".pdf")) {
    throw new Error("That file path is not allowed.");
  }
  return registerListedObject({
    bucket: "documents",
    path: input.path,
    mimeType: "application/pdf",
    byteSize: input.byteSize,
    kind: input.kind,
    uploadedBy: input.uploadedBy,
    entityTable: "visit_documents",
    ownerId: input.ownerId,
  });
}

async function registerListedObject(input: {
  bucket: StorageTicket["bucket"];
  path: string;
  mimeType: string;
  byteSize: number;
  kind: string;
  uploadedBy: string | null;
  entityTable: string;
  ownerId: string;
}) {
  const admin = adminOrThrow();
  const folder = input.path.split("/").slice(0, -1).join("/");
  const name = input.path.split("/").pop() ?? "";
  const listed = await admin.storage.from(input.bucket).list(folder, { search: name, limit: 10 });
  if (!listed.data?.some((item) => item.name === name)) throw new Error("Upload the file before saving it.");
  const registered = await admin.rpc("orbit_register_file", {
    p_bucket: input.bucket,
    p_storage_path: input.path,
    p_mime_type: input.mimeType,
    p_byte_size: input.byteSize,
    p_checksum: null,
    p_uploaded_by: input.uploadedBy,
    p_entity_schema: "ops",
    p_entity_table: input.entityTable,
    p_entity_id: input.ownerId,
    p_kind: input.kind,
  });
  if (registered.error || !registered.data) throw new Error("Could not register that file.");
  return { fileId: registered.data as string };
}

export async function downloadStorageObject(bucket: string, path: string) {
  const downloaded = await adminOrThrow().storage.from(bucket).download(path);
  if (downloaded.error || !downloaded.data) return null;
  return new Uint8Array(await downloaded.data.arrayBuffer());
}
