/** A missing mail key, or a send that only wrote a log, must not count as delivery. */
export function emailCodesAvailable(env: Record<string, string | undefined>) {
  return Boolean(env.RESEND_API_KEY?.trim());
}

export function emailSendAccepted(status: "logged" | "sent" | "failed" | "redirected") {
  return status === "sent" || status === "redirected";
}

export const EMAIL_CODE_UNAVAILABLE = "Email codes are not available. Use an authenticator app.";
