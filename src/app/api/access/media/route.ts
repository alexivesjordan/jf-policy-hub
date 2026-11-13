import { NextResponse } from "next/server";
import { hashPulseToken } from "@/lib/pulse/token-hash";
import { storePulseFile } from "@/lib/pulse/files";
import { PulseFileError } from "@/lib/pulse/prepare-upload";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const hash = hashPulseToken(token);
  const file = form.get("file");
  if (!hash || !(file instanceof File) || file.size === 0) {
    return NextResponse.json({ message: "Choose a photo or video." }, { status: 400 });
  }
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ message: "Supabase is not configured." }, { status: 500 });
  const preview = await admin.rpc("install_access_preview", { p_token_hash: hash });
  const installId = (preview.data as { install_id?: string } | null)?.install_id;
  if (!installId) return NextResponse.json({ message: "That link is not valid." }, { status: 400 });
  try {
    const stored = await storePulseFile({
      bucket: "access-media",
      mimeType: file.type || "application/octet-stream",
      bytes: Buffer.from(await file.arrayBuffer()),
      uploadedBy: null,
      entitySchema: "ops",
      entityTable: "installs",
      entityId: installId,
      kind: file.type.startsWith("video/") ? "video" : "photo",
    });
    return NextResponse.json({ fileId: stored.fileId });
  } catch (error) {
    const message = error instanceof PulseFileError || error instanceof Error ? error.message : "Could not store that file.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
