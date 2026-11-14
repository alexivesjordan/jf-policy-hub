import "server-only";

import { accessMediaBytesMatch, accessMediaPathOk, planAccessMediaUpload, readStoredObjectHead, storedAccessMediaOk } from "@/lib/pulse/access-upload";
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

/** Confirms the stored object the same way access media does, then registers it. */
export async function registerPhotoObject(input: { path: string; ownerId: string; kind: string; uploadedBy: string | null }) {
  const admin = adminOrThrow();
  if (!accessMediaPathOk(input.ownerId, input.path)) throw new Error("That file path is not allowed.");
  const info = await admin.storage.from("job-sheets").info(input.path);
  if (info.error || info.data?.size == null || !info.data.contentType) throw new Error("Upload the file before saving it.");
  const mimeType = info.data.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const plan = storedAccessMediaOk(input.path, mimeType, info.data.size);
  if (!plan.ok) {
    await admin.storage.from("job-sheets").remove([input.path]);
    throw new Error(plan.message);
  }
  if (plan.kind !== "photo") {
    await admin.storage.from("job-sheets").remove([input.path]);
    throw new Error("Use a photo.");
  }
  const head = await objectHead(admin, "job-sheets", input.path);
  if (!head || !accessMediaBytesMatch(mimeType, head)) {
    await admin.storage.from("job-sheets").remove([input.path]);
    throw new Error("That file type is not allowed.");
  }
  return registerObject({
    bucket: "job-sheets",
    path: input.path,
    mimeType,
    byteSize: info.data.size,
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

export async function registerDocumentObject(input: { path: string; ownerId: string; kind: string; uploadedBy: string | null }) {
  const admin = adminOrThrow();
  if (!pathBelongsToInstall(input.ownerId, input.path) || !input.path.toLowerCase().endsWith(".pdf")) {
    throw new Error("That file path is not allowed.");
  }
  const info = await admin.storage.from("documents").info(input.path);
  if (info.error || info.data?.size == null || info.data.size <= 0 || info.data.size > PDF_LIMIT) {
    if (!info.error) await admin.storage.from("documents").remove([input.path]);
    throw new Error("Upload a PDF of 20 MB or smaller.");
  }
  const mimeType = info.data.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  const head = await objectHead(admin, "documents", input.path);
  const pdf = head != null && head.length >= 4 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
  if (mimeType !== "application/pdf" || !pdf) {
    await admin.storage.from("documents").remove([input.path]);
    throw new Error("Upload a PDF.");
  }
  return registerObject({
    bucket: "documents",
    path: input.path,
    mimeType: "application/pdf",
    byteSize: info.data.size,
    kind: input.kind,
    uploadedBy: input.uploadedBy,
    entityTable: "visit_documents",
    ownerId: input.ownerId,
  });
}

async function objectHead(admin: ReturnType<typeof adminOrThrow>, bucket: string, path: string) {
  const signed = await admin.storage.from(bucket).createSignedUrl(path, 60);
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

async function registerObject(input: {
  bucket: StorageTicket["bucket"];
  path: string;
  mimeType: string;
  byteSize: number;
  kind: string;
  uploadedBy: string | null;
  entityTable: string;
  ownerId: string;
}) {
  const registered = await adminOrThrow().rpc("orbit_register_file", {
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
