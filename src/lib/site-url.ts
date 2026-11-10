/** Public origin for auth redirects. Production sets NEXT_PUBLIC_SITE_URL. */
export function resolveSiteUrl(env: Record<string, string | undefined>) {
  const configured = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const vercel = env.VERCEL_URL?.trim();
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `https://${host}`;
  }

  return "http://localhost:3000";
}

export function siteUrl() {
  return resolveSiteUrl(process.env);
}

/** redirect_to for invite, magic link, and recovery. Optional next is read by /auth/confirm. */
export function authConfirmRedirect(next?: string) {
  const base = `${siteUrl()}/auth/confirm`;
  if (!next) return base;
  return `${base}?next=${encodeURIComponent(next)}`;
}
