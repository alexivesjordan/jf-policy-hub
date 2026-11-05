import { connection } from "next/server";
import { OrbitFileError, isOrbitBucket } from "@/lib/orbit/prepare-upload";
import { storeOrbitFile } from "@/lib/orbit/files";
import { orbitRpcError } from "@/lib/orbit/http";
import { orbitSession, requireOpsRole } from "@/lib/orbit/session";

export async function POST(request: Request) {
  await connection();
  const session = await orbitSession();
  if (!session.ok) return session.response;

  const allowed = await requireOpsRole(session.supabase, ["install_lead", "admin_owner"]);
  if (!allowed.ok) return orbitRpcError(allowed.error, "Could not check access.");
  if (!allowed.allowed) {
    return Response.json({ error: "You cannot upload that file." }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Send the file as multipart form data." }, { status: 400 });
  }

  const bucket = String(form.get("bucket") ?? "");
  const entitySchema = String(form.get("entity_schema") ?? "");
  const entityTable = String(form.get("entity_table") ?? "");
  const entityId = String(form.get("entity_id") ?? "");
  const kind = String(form.get("kind") ?? "file");
  const file = form.get("file");

  if (!isOrbitBucket(bucket) || !file || !(file instanceof File)) {
    return Response.json({ error: "Choose a bucket and a file." }, { status: 400 });
  }
  if (!/^(ops|core)$/.test(entitySchema) || !/^[a-z][a-z0-9_]{0,62}$/.test(entityTable)) {
    return Response.json({ error: "That file cannot be linked to that record." }, { status: 400 });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entityId)) {
    return Response.json({ error: "That record id is not valid." }, { status: 400 });
  }

  try {
    const stored = await storeOrbitFile({
      bucket,
      mimeType: file.type || "application/octet-stream",
      bytes: Buffer.from(await file.arrayBuffer()),
      uploadedBy: session.profile.id,
      entitySchema,
      entityTable,
      entityId,
      kind: kind.slice(0, 40) || "file",
    });
    return Response.json(stored, { status: 201 });
  } catch (error) {
    if (error instanceof OrbitFileError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof Error && error.message === "Supabase is not configured.") {
      return Response.json({ error: error.message }, { status: 500 });
    }
    return Response.json({ error: "Could not store that file." }, { status: 500 });
  }
}
