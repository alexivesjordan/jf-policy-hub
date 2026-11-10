import { safeNextPath } from "@/lib/access";

const OTP_TYPES = new Set(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

export type AuthArrival =
  | { kind: "otp"; tokenHash: string; otpType: string }
  | { kind: "pkce"; code: string }
  | { kind: "session"; accessToken: string; refreshToken: string; otpType: string | null }
  | { kind: "error" }
  | { kind: "missing" };

/**
 * Classify the URL Supabase sends the browser to after an email link.
 *
 * Default templates link to Auth's /verify endpoint. That endpoint then
 * redirects here in one of two shapes (supabase/auth verify.go):
 * - PKCE, when the email token is prefixed pkce_: `?code=`
 * - Implicit, when it is not (admin invites, and a recovery with no code
 *   challenge): `#access_token=&refresh_token=&type=`
 * A later custom template can instead open this page with `?token_hash=&type=`.
 */
export function readAuthArrival(href: string): AuthArrival {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { kind: "missing" };
  }

  const query = url.searchParams;
  const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);

  const tokenHash = query.get("token_hash");
  const queryType = query.get("type");
  if (tokenHash && queryType && OTP_TYPES.has(queryType)) {
    return { kind: "otp", tokenHash, otpType: queryType };
  }

  const queryError = query.get("error_description") || query.get("error") || query.get("error_code");
  const code = query.get("code");
  if (code && !queryError) {
    return { kind: "pkce", code };
  }

  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (accessToken && refreshToken) {
    const hashType = hash.get("type");
    return {
      kind: "session",
      accessToken,
      refreshToken,
      otpType: hashType && OTP_TYPES.has(hashType) ? hashType : null,
    };
  }

  const hashError = hash.get("error_description") || hash.get("error") || hash.get("error_code");
  if (queryError || hashError) return { kind: "error" };
  return { kind: "missing" };
}

export function passwordSetupPath() {
  return "/account/password?setup=1";
}

/** Invite and recovery always finish on set-password. Other mail uses a safe next path. */
export function confirmDestination(otpType: string | null, next: string | null) {
  if (otpType === "invite" || otpType === "recovery") return passwordSetupPath();
  return safeNextPath(next, "/");
}

/**
 * A recovery or invite link that still opens the password page has not established
 * a session yet. Send it through /auth/confirm first. The browser keeps any
 * fragment, so an implicit token can be posted from that page.
 */
export function passwordLinkHandoff(path: string, search: URLSearchParams): string | null {
  if (path !== "/account/password") return null;
  const tokenHash = search.get("token_hash");
  const code = search.get("code");
  if (!tokenHash && !code && search.get("setup") !== "1") return null;

  const dest = new URLSearchParams(search);
  if (!dest.get("next")) dest.set("next", passwordSetupPath());
  if (!tokenHash && !code) dest.delete("setup");
  const query = dest.toString();
  return query ? `/auth/confirm?${query}` : "/auth/confirm";
}
