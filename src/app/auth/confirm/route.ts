import { connection } from "next/server";
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNextPath } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES = new Set<EmailOtpType>(["invite", "recovery", "email", "signup", "magiclink"]);

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = safeNextPath(url.searchParams.get("next"), "/account/password");

  if (!tokenHash || !type || !OTP_TYPES.has(type as EmailOtpType)) {
    return NextResponse.redirect(new URL("/login?error=link", url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type: type as EmailOtpType,
    token_hash: tokenHash,
  });

  if (error) {
    console.error(error);
    return NextResponse.redirect(new URL("/login?error=link", url.origin));
  }

  const destination =
    type === "invite" || type === "recovery" ? withPasswordSetup(next) : next;
  return NextResponse.redirect(new URL(destination, url.origin));
}

function withPasswordSetup(path: string) {
  if (!path.startsWith("/account/password") || path.includes("setup=")) return path;
  return `${path}${path.includes("?") ? "&" : "?"}setup=1`;
}
