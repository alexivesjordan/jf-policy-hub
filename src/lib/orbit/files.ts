import "server-only";

import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  orbitStoragePath,
  prepareOrbitUpload,
  type OrbitBucket,
} from "@/lib/orbit/prepare-upload";

const SIGNED_URL_SECONDS = 60 * 10;

export async function storeOrbitFile(input: {
  bucket: OrbitBucket;
  mimeType: string;
  bytes: Buffer;
  uploadedBy: string;
  entitySchema: string;
  entityTable: string;
  entityId: string;
  kind: string;
}) {
  const prepared = await prepareOrbitUpload(input.bucket, input.mimeType, input.bytes);
  const storagePath = orbitStoragePath(input.entitySchema, input.entityId, prepared.extension);
  const admin = createAdminClient();
  if (!admin) throw new Error("Supabase is not configured.");

  const checksum = createHash("sha256").update(prepared.bytes).digest("hex");
  const uploaded = await admin.storage.from(input.bucket).upload(storagePath, prepared.bytes, {
    contentType: prepared.mimeType,
    upsert: false,
  });
  if (uploaded.error) {
    console.error("file upload failed", uploaded.error.message);
    throw new Error("Could not store that file.");
  }

  const registered = await admin.rpc("orbit_register_file", {
    p_bucket: input.bucket,
    p_storage_path: storagePath,
    p_mime_type: prepared.mimeType,
    p_byte_size: prepared.bytes.length,
    p_checksum: checksum,
    p_uploaded_by: input.uploadedBy,
    p_entity_schema: input.entitySchema,
    p_entity_table: input.entityTable,
    p_entity_id: input.entityId,
    p_kind: input.kind,
  });

  if (registered.error || !registered.data) {
    console.error("file register failed", registered.error?.code ?? "no id");
    await admin.storage.from(input.bucket).remove([storagePath]);
    throw new Error("Could not register that file.");
  }

  const signed = await admin.storage.from(input.bucket).createSignedUrl(storagePath, SIGNED_URL_SECONDS);
  if (signed.error || !signed.data?.signedUrl) {
    console.error("signed url failed", signed.error?.message ?? "missing url");
    throw new Error("The file was stored, but a link could not be signed.");
  }

  return {
    fileId: registered.data as string,
    signedUrl: signed.data.signedUrl,
    expiresIn: SIGNED_URL_SECONDS,
    mimeType: prepared.mimeType,
    byteSize: prepared.bytes.length,
  };
}
