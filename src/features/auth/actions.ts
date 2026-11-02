"use server";

import { redirect } from "next/navigation";
import { isCompanyEmail, normaliseEmail, safeNextPath } from "@/lib/access";
import type { ActionState } from "@/lib/action-state";
import { createClient } from "@/lib/supabase/server";
import { requestOrigin } from "@/lib/auth";

function clean(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordReset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = normaliseEmail(clean(formData.get("email")));
  if (!isCompanyEmail(email)) {
    return { ok: false, message: "Use your @jordanfitness.com email address." };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return { ok: false, message: "Supabase is not configured." };
  }

  // The cookie client always sends a PKCE code challenge. Supabase then
  // redirects with ?code=, which only works in the browser that stored the
  // verifier. This request omits the challenge, so the default reset email
  // redirects with the session in the hash and works on any device. Admin
  // invites already do that. /auth/confirm accepts both shapes.
  const origin = await requestOrigin();
  const endpoint = new URL("/auth/v1/recover", url);
  endpoint.searchParams.set("redirect_to", `${origin}/auth/confirm`);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = (await response.text()).toLowerCase();
    if (detail.includes("rate") || detail.includes("seconds") || detail.includes("once")) {
      return { ok: false, message: "Please wait a moment, then request another email." };
    }
    if (!detail.includes("not found") && !detail.includes("signup")) {
      console.error("Password reset email failed", response.status);
      return {
        ok: false,
        message: "We could not send the email. Check that email is switched on in Supabase, then try again.",
      };
    }
  }

  return {
    ok: true,
    message: "If that address has an account, we sent a link to choose a password. It may take a minute to arrive.",
  };
}

export async function changePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const password = clean(formData.get("password"));
  const confirm = clean(formData.get("confirm"));
  const next = safeNextPath(clean(formData.get("next")) || null, "/");

  if (password.length < 8) {
    return { ok: false, message: "Use at least 8 characters." };
  }
  if (password !== confirm) {
    return { ok: false, message: "Those passwords do not match." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, message: "That link has expired. Request a new one from the sign-in page." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    const detail = error.message.toLowerCase();
    if (detail.includes("at least") || detail.includes("weak") || detail.includes("character")) {
      return { ok: false, message: "Use a longer password. Supabase is set to require more than 8 characters." };
    }
    console.error(error);
    return { ok: false, message: "We could not save that password. Request a new link and try again." };
  }

  redirect(next);
}
