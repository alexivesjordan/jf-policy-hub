import "server-only";

import { createHash, randomUUID } from "crypto";
import { sniffStoredFile } from "@/lib/installs/compress-image";
import { pathBelongsToInstall } from "@/lib/installs/permissions";
import type { StorageTicket } from "@/lib/installs/upload-ticket";
import { createAdminClient } from "@/lib/supabase/admin";

export type { StorageTicket };

const PHOTO_LIMIT = 8 * 1024 * 1024;
const PDF_LIMIT = 20 * 1024 * 1024;

function adminOrThrow() {
  const admin = createAdminClient();
  if (!admin) throw new Error("Supabase is not configured.");
  return admin;
}

/** A short-lived URL. The phone uploads the bytes to Storage, not to this server. */
export async function issueStorageTicket(input: { bucket: StorageTicket["bucket"]; ownerId: string; extension: "jpg" | "pdf" }) {
  const path = `ops/${input.ownerId}/${randomUUID()}.${input.extension}`;
  if (!pathBelongsToInstall(input.ownerId, path)) throw new Error("That job was not found.");
  const signed = await adminOrThrow().storage.from(input.bucket).createSignedUploadUrl(path);
  if (signed.error || !signed.data?.token || !signed.data.signedUrl) throw new Error("Could not start that upload.");
  return {
    bucket: input.bucket,
    path: signed.data.path,
    token: signed.data.token,
    signedUrl: signed.data.signedUrl,
  } satisfies StorageTicket;
}

/** After the direct upload, check the object and record it on the job. */
export async function registerStorageObject(input: {
  bucket: StorageTicket["bucket"];
  path: string;
  ownerId: string;
  kind: string;
  uploadedBy: string | null;
  entityTable: string;
  expect: "photo" | "pdf";
}) {
  if (!pathBelongsToInstall(input.ownerId, input.path)) throw new Error("That file is not on this job.");
  const admin = adminOrThrow();
  const downloaded = await admin.storage.from(input.bucket).download(input.path);
  if (downloaded.error || !downloaded.data) throw new Error("That upload did not arrive.");
  const bytes = Buffer.from(await downloaded.data.arrayBuffer());
  const limit = input.expect === "pdf" ? PDF_LIMIT : PHOTO_LIMIT;
  const mime = sniffStoredFile(bytes);
  const allowed = input.expect === "pdf" ? mime === "application/pdf" : mime === "image/jpeg" || mime === "image/png" || mime === "image/webp";
  if (!allowed || !mime || bytes.length === 0 || bytes.length > limit) {
    await admin.storage.from(input.bucket).remove([input.path]);
    throw new Error(input.expect === "pdf" ? "Upload a PDF of 20 MB or smaller." : "Use a photo of 8 MB or smaller.");
  }
  const registered = await admin.rpc("orbit_register_file", {
    p_bucket: input.bucket,
    p_storage_path: input.path,
    p_mime_type: mime,
    p_byte_size: bytes.length,
    p_checksum: createHash("sha256").update(bytes).digest("hex"),
    p_uploaded_by: input.uploadedBy,
    p_entity_schema: "ops",
    p_entity_table: input.entityTable,
    p_entity_id: input.ownerId,
    p_kind: input.kind,
  });
  if (registered.error || !registered.data) {
    await admin.storage.from(input.bucket).remove([input.path]);
    throw new Error("Could not register that file.");
  }
  return { fileId: registered.data as string, bytes, mime };
}

export async function downloadStorageObject(bucket: string, path: string) {
  const downloaded = await adminOrThrow().storage.from(bucket).download(path);
  if (downloaded.error || !downloaded.data) return null;
  return new Uint8Array(await downloaded.data.arrayBuffer());
}
