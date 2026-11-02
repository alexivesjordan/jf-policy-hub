/**
 * Checks that /auth/confirm understands the URLs Supabase Auth actually
 * redirects to. The shapes are taken from supabase/auth (verify.go,
 * internal/tokens/service.go AsRedirectURL, internal/api/pkce.go):
 *
 * - PKCE verify redirects with query ?code= (prepPKCERedirectURL).
 * - Implicit verify redirects with a fragment built by AsRedirectURL,
 *   after verify.go sets type=invite or type=recovery.
 * - A custom template can open the page with ?token_hash=&type= instead.
 *
 * Go's url.Values.Encode sorts keys and uses QueryEscape. This script
 * builds those strings the same way and checks the classifier.
 */
import { readAuthArrival } from "../src/lib/auth-link";

const APP = "https://jf-policy-hub.vercel.app/auth/confirm";

function queryEscape(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function goEncode(values: Record<string, string>) {
  return Object.keys(values)
    .sort()
    .map((key) => `${queryEscape(key)}=${queryEscape(values[key] ?? "")}`)
    .join("&");
}

function prepPkceRedirect(redirectTo: string, code: string) {
  const url = new URL(redirectTo);
  url.searchParams.set("code", code);
  return url.toString();
}

function asRedirectUrl(redirectTo: string, extra: Record<string, string>) {
  const params = {
    ...extra,
    access_token: "eyJhbGciOiJ.header.sig",
    token_type: "bearer",
    expires_in: "3600",
    expires_at: "1700000000",
    refresh_token: "refresh-token-value",
    sb: "",
  };
  return `${redirectTo}#${goEncode(params)}`;
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    console.error(message);
    process.exitCode = 1;
  }
}

const pkce = prepPkceRedirect(APP, "11111111-1111-1111-1111-111111111111");
const pkceArrival = readAuthArrival(pkce);
assert(pkceArrival.kind === "pkce" && pkceArrival.code.startsWith("11111111"), `PKCE redirect was ${pkceArrival.kind}: ${pkce}`);

const invite = asRedirectUrl(APP, { type: "invite" });
const inviteArrival = readAuthArrival(invite);
assert(
  inviteArrival.kind === "session" && inviteArrival.otpType === "invite" && inviteArrival.refreshToken === "refresh-token-value",
  `Invite fragment was ${JSON.stringify(inviteArrival)} from ${invite}`,
);

const recovery = asRedirectUrl(APP, { type: "recovery" });
const recoveryArrival = readAuthArrival(recovery);
assert(
  recoveryArrival.kind === "session" && recoveryArrival.otpType === "recovery",
  `Recovery fragment was ${JSON.stringify(recoveryArrival)}`,
);

const tokenHash = `${APP}?token_hash=hashed-token&type=recovery&next=%2Faccount%2Fpassword`;
const otp = readAuthArrival(tokenHash);
assert(otp.kind === "otp" && otp.otpType === "recovery" && otp.tokenHash === "hashed-token", "token_hash link was not recognised");

const inviteOtp = readAuthArrival(`${APP}?token_hash=invite-hash&type=invite`);
assert(inviteOtp.kind === "otp" && inviteOtp.otpType === "invite", "invite token_hash link was not recognised");

const pkceError = readAuthArrival(`${APP}?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
assert(pkceError.kind === "error", "PKCE error redirect was not recognised");

const implicitError = readAuthArrival(`${APP}#${goEncode({ error: "access_denied", error_code: "otp_expired", error_description: "Email link is invalid or has expired", sb: "" })}`);
assert(implicitError.kind === "error", "Implicit error fragment was not recognised");

assert(readAuthArrival(APP).kind === "missing", "A bare confirm URL should wait for the fragment");

if (process.exitCode) {
  console.error("Auth link checks failed");
} else {
  console.log("Auth link checks passed");
  console.log("pkce", pkce);
  console.log("invite", invite);
  console.log("recovery", recovery);
}
