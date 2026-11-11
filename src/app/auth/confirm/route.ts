import { connection } from "next/server";
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { confirmGetPlan, confirmRedirect, continueToPulsePage, implicitContinuePage } from "@/lib/auth-confirm";
import { confirmDestination } from "@/lib/auth-link";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES = new Set(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

function html(body: string) {
  return new NextResponse(body, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const plan = confirmGetPlan(url.searchParams);
  if (plan === "error") return confirmRedirect(url.origin, "/login?error=link");
  if (plan === "implicit") return html(implicitContinuePage());
  return html(continueToPulsePage(plan));
}

export async function POST(request: Request) {
  await connection();
  const url = new URL(request.url);
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    return verifyPostedLink(await request.formData(), url.origin);
  }

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

async function verifyPostedLink(form: FormData, origin: string) {
  const tokenHash = String(form.get("token_hash") ?? "");
  const type = String(form.get("type") ?? "");
  const code = String(form.get("code") ?? "");
  const next = String(form.get("next") ?? "") || null;
  const supabase = await createClient();

  if (tokenHash && OTP_TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash: tokenHash,
    });
    if (error) return confirmRedirect(origin, "/login?error=link");
    return confirmRedirect(origin, confirmDestination(type, next));
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return confirmRedirect(origin, "/login?error=link");
    return confirmRedirect(origin, confirmDestination(type || null, next));
  }

  return confirmRedirect(origin, "/login?error=link");
}
