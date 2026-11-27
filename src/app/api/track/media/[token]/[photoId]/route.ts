import { connection } from "next/server";
import { NextResponse } from "next/server";
import { isFixtureMode } from "@/lib/env";
import { FIXTURE_PHOTO, FIXTURE_TRACK_TOKEN, fixturePngBytes } from "@/lib/tracker/fixture";
import { hashPulseToken } from "@/lib/pulse/token-hash";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function missing() {
  return new NextResponse(null, {
    status: 404,
    headers: { "X-Robots-Tag": "noindex", "Cache-Control": "private, no-store" },
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string; photoId: string }> },
) {
  await connection();
  const { token, photoId } = await context.params;
  if (!UUID.test(photoId)) return missing();
  if (isFixtureMode()) {
    if (token !== FIXTURE_TRACK_TOKEN || photoId !== FIXTURE_PHOTO) return missing();
    return new NextResponse(new Uint8Array(fixturePngBytes()), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=60",
        "X-Robots-Tag": "noindex",
      },
    });
  }

  const hash = hashPulseToken(token);
  const admin = createAdminClient();
  if (!hash || !admin) return missing();
  const media = await admin.rpc("order_tracker_media", { p_token_hash: hash, p_photo_id: photoId });
  const row = media.data as { bucket?: string; path?: string } | null;
  if (media.error || row?.bucket !== "qc" || !row.path) return missing();
  const signed = await admin.storage.from("qc").createSignedUrl(row.path, 60);
  if (signed.error || !signed.data?.signedUrl) return missing();
  return NextResponse.redirect(signed.data.signedUrl, {
    headers: {
      "Cache-Control": "private, max-age=60",
      "X-Robots-Tag": "noindex",
    },
  });
}
