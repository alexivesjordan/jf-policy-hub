import { connection } from "next/server";
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { confirmDestination } from "@/lib/auth-link";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES = new Set(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

const IMPLICIT_PAGE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Signing in</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#111111;color:#ffffff;padding:32px;">
<p style="letter-spacing:0.12em;text-transform:uppercase;font-size:12px;color:#c4c4c4;">Jordan Pulse</p>
<p>Signing you in…</p>
<script>
(function () {
  var hash = new URLSearchParams(location.hash.charAt(0) === "#" ? location.hash.slice(1) : location.hash);
  var access = hash.get("access_token");
  var refresh = hash.get("refresh_token");
  if (!access || !refresh) {
    location.replace("/login?error=link");
    return;
  }
  var next = new URLSearchParams(location.search).get("next");
  fetch("/auth/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ access_token: access, refresh_token: refresh, type: hash.get("type"), next: next })
  }).then(function (res) { return res.json(); }).then(function (body) {
    location.replace((body && body.redirect) || "/login?error=link");
  }).catch(function () {
    location.replace("/login?error=link");
  });
})();
</script>
</body>
</html>`;

function loginRedirect(origin: string) {
  return NextResponse.redirect(new URL("/login?error=link", origin));
}

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  const errored = url.searchParams.get("error") || url.searchParams.get("error_description");

  if (errored) return loginRedirect(url.origin);

  if (!tokenHash && !code) {
    return new NextResponse(IMPLICIT_PAGE, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const supabase = await createClient();
  const otpType = type;

  if (tokenHash && type && OTP_TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash: tokenHash,
    });
    if (error) return loginRedirect(url.origin);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return loginRedirect(url.origin);
  } else {
    return loginRedirect(url.origin);
  }

  return NextResponse.redirect(new URL(confirmDestination(otpType, next), url.origin));
}

export async function POST(request: Request) {
  await connection();
  let body: { access_token?: unknown; refresh_token?: unknown; type?: unknown; next?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ redirect: "/login?error=link" }, { status: 400 });
  }

  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
  const otpType = typeof body.type === "string" ? body.type : null;
  const next = typeof body.next === "string" ? body.next : null;
  if (!accessToken || !refreshToken) {
    return Response.json({ redirect: "/login?error=link" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) return Response.json({ redirect: "/login?error=link" }, { status: 400 });

  return Response.json({ redirect: confirmDestination(otpType, next) });
}
