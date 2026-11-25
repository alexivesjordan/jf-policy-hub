import { createHash } from "node:crypto";

export function caseTokenFromAddress(address: string, domain: string) {
  const host = domain.trim().toLowerCase().replace(/^@/, "");
  if (!host) return null;
  const email = address.trim().toLowerCase().match(/<([^>]+)>/)?.[1] ?? address.trim().toLowerCase();
  const match = new RegExp(`^case-([a-z0-9]{16,64})@${host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`).exec(email);
  return match?.[1] ?? null;
}

export function hashCaseToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function inboundCaseEnabled(env: Record<string, string | undefined>) {
  return env.HR_CASE_INBOUND_ENABLED?.trim() === "1";
}
