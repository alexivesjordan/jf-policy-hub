"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { deliverPulseEmail } from "@/lib/email/deliver";
import { createClient } from "@/lib/supabase/server";
import { EMAIL_CODE_UNAVAILABLE, emailCodesAvailable, emailSendAccepted } from "@/lib/two-step-email";

function sixDigitCode() {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return value.toString().padStart(6, "0");
}

export async function sendSignInCode(): Promise<{ ok: boolean; message: string }> {
  if (!emailCodesAvailable(process.env)) return { ok: false, message: EMAIL_CODE_UNAVAILABLE };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email;
  if (!email) return { ok: false, message: "Sign in first." };
  const code = sixDigitCode();
  const started = await supabase.rpc("email_code_start", { p_code: code });
  if (started.error) {
    const text = started.error.message ?? "";
    if (text.includes("Too many")) return { ok: false, message: "Too many codes. Try again later." };
    return { ok: false, message: EMAIL_CODE_UNAVAILABLE };
  }
  const sent = await deliverPulseEmail({
    to: email,
    subject: "Your Jordan Pulse code",
    template: "two-step-code",
    text: `Your Jordan Pulse code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your Jordan Pulse code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
  });
  if (!emailSendAccepted(sent.status)) return { ok: false, message: EMAIL_CODE_UNAVAILABLE };
  return { ok: true, message: "Code sent. Enter it below." };
}

export async function confirmSignInCode(code: string): Promise<{ ok: boolean; message: string }> {
  const trimmed = code.trim();
  if (!/^[0-9]{6}$/.test(trimmed)) return { ok: false, message: "Enter the 6-digit code." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("email_code_verify", { p_code: trimmed });
  if (error || data !== true) return { ok: false, message: "That code was not accepted." };
  await rememberThisDevice();
  return { ok: true, message: "Signed in." };
}

export async function rememberThisDevice() {
  const supabase = await createClient();
  const store = await cookies();
  const hash = store.get("pulse-device")?.value ?? "";
  if (hash.length < 16) return;
  await supabase.rpc("trust_device", { p_hash: hash });
}

export async function setTwoStepEnforcement(formData: FormData) {
  const supabase = await createClient();
  const enabled = formData.get("enforcement") === "on";
  const { error } = await supabase.rpc("set_two_step_enforcement", { p_enabled: enabled });
  if (error) redirect("/settings/workspace/security?error=1");
  revalidatePath("/settings/workspace/security");
  redirect("/settings/workspace/security?saved=1");
}
