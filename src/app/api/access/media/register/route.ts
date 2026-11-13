import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { hashPulseToken } from "@/lib/pulse/token-hash";
import { accessMediaExtension } from "@/lib/pulse/prepare-upload";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { token?: string; path?: string; mime?: string; byteSize?: number; checksum?: string };
    const hash = hashPulseToken(String(body.token ?? ""));
    const path = String(body.path ?? "");
    const mime = String(body.mime ?? "");
    const byteSize = Number(body.byteSize ?? 0);
    const checksum = String(body.checksum ?? "");
    if (!hash || !accessMediaExtension(mime) || !/^[a-z0-9][a-z0-9_./-]{0,480}$/.test(path) || path.includes("..")) {
      return NextResponse.json({ message: "Could not store that file." }, { status: 400 });
    }
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ message: "Supabase is not configured." }, { status: 500 });
    const preview = await admin.rpc("install_access_preview", { p_token_hash: hash });
    const installId = (preview.data as { install_id?: string } | null)?.install_id;
    if (!installId || !path.startsWith(`ops/${installId}/`)) {
      return NextResponse.json({ message: "That link is not valid." }, { status: 400 });
    }
    const registered = await admin.rpc("orbit_register_file", {
      p_bucket: "access-media",
      p_storage_path: path,
      p_mime_type: mime,
      p_byte_size: byteSize,
      p_checksum: checksum || createHash("sha256").update(path).digest("hex"),
      p_uploaded_by: null,
      p_entity_schema: "ops",
      p_entity_table: "installs",
      p_entity_id: installId,
      p_kind: mime.startsWith("video/") ? "video" : "photo",
    });
    if (registered.error || !registered.data) return NextResponse.json({ message: "Could not store that file." }, { status: 400 });
    return NextResponse.json({ fileId: registered.data });
  } catch {
    return NextResponse.json({ message: "Could not store that file." }, { status: 400 });
  }
}
