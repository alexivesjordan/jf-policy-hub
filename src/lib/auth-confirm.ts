const OTP_TYPES = new Set(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

export type ConfirmContinue = {
  tokenHash: string | null;
  otpType: string | null;
  code: string | null;
  next: string | null;
};

/** What GET /auth/confirm may do. It never verifies a token. */
export function confirmGetPlan(params: URLSearchParams): "error" | "implicit" | ConfirmContinue {
  if (params.get("error") || params.get("error_description") || params.get("error_code")) return "error";
  const tokenHash = params.get("token_hash");
  const otpType = params.get("type");
  const code = params.get("code");
  const next = params.get("next");
  if (tokenHash && otpType && OTP_TYPES.has(otpType)) {
    return { tokenHash, otpType, code: null, next };
  }
  if (code) return { tokenHash: null, otpType, code, next };
  if (tokenHash || otpType) return "error";
  return "implicit";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function hidden(name: string, value: string | null) {
  if (!value) return "";
  return `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
}

/** Continue page. The token stays in the form until the person submits it. */
export function continueToPulsePage(fields: ConfirmContinue) {
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Continue to Jordan Pulse</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #ffffff; color: #111111; font-family: "Space Grotesk", "Segoe UI", sans-serif; }
  main { width: 100%; max-width: 28rem; padding: 2.5rem 1.5rem; }
  .mark { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.22em; text-transform: uppercase; color: #6b6b6b; }
  h1 { margin: 0.75rem 0 1.5rem; font-size: 2.25rem; font-weight: 500; letter-spacing: -0.03em; }
  button { background: #111111; color: #ffffff; border: 0; padding: 0.85rem 1.25rem; font: inherit; font-weight: 600; cursor: pointer; }
</style>
</head>
<body>
<main>
<p class="mark">Jordan Pulse</p>
<h1>Continue to Jordan Pulse</h1>
<form method="post" action="/auth/confirm">
${hidden("token_hash", fields.tokenHash)}
${hidden("type", fields.otpType)}
${hidden("code", fields.code)}
${hidden("next", fields.next)}
<button type="submit">Continue</button>
</form>
</main>
</body>
</html>`;
}
