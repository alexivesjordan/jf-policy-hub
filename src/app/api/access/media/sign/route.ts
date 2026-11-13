import { NextResponse } from "next/server";
import { hashPulseToken } from "@/lib/pulse/token-hash";
import { accessMediaExtension, pulseStoragePath } from "@/lib/pulse/prepare-upload";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFixtureMode } from "@/lib/env";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { token?: string; mime?: string };
    const hash = hashPulseToken(String(body.token ?? ""));
    const mime = String(body.mime ?? "");
    const extension = accessMediaExtension(mime);
    if (!hash || !extension) return NextResponse.json({ message: "That file type is not allowed." }, { status: 400 });
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ message: "Supabase is not configured." }, { status: 500 });
    const preview = await admin.rpc("install_access_preview", { p_token_hash: hash });
    const installId = (preview.data as { install_id?: string } | null)?.install_id;
    if (!installId) return NextResponse.json({ message: "That link is not valid." }, { status: 400 });
    const path = pulseStoragePath("ops", installId, extension);
    if (isFixtureMode()) {
      return NextResponse.json({ signedUrl: "/api/access/media/fixture-upload", path, token: "fixture" });
    }
    const signed = await admin.storage.from("access-media").createSignedUploadUrl(path);
    if (signed.error || !signed.data?.signedUrl) {
      return NextResponse.json({ message: "Could not start that upload." }, { status: 400 });
    }
    return NextResponse.json({ signedUrl: signed.data.signedUrl, path: signed.data.path, token: signed.data.token });
  } catch {
    return NextResponse.json({ message: "Could not start that upload." }, { status: 400 });
  }
}
