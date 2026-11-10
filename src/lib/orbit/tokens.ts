import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { generateOrbitToken, hashOrbitToken } from "@/lib/orbit/token-hash";

export type TokenPurpose = "access_form" | "portal" | "subcontractor_job" | "tc_accept";

export type ResolvedToken = {
  id: string;
  purpose: TokenPurpose;
  entity_schema: string;
  entity_table: string;
  entity_id: string;
  expires_at: string | null;
};

function adminOrThrow() {
  const admin = createAdminClient();
  if (!admin) throw new Error("Supabase is not configured.");
  return admin;
}

export async function createTokenLink(input: {
  purpose: TokenPurpose;
  entitySchema: string;
  entityTable: string;
  entityId: string;
  expiresAt?: string | null;
}) {
  const issued = generateOrbitToken();
  const admin = adminOrThrow();
  const { data, error } = await admin.rpc("orbit_store_token_link", {
    p_purpose: input.purpose,
    p_token_hash: issued.hashHex,
    p_entity_schema: input.entitySchema,
    p_entity_table: input.entityTable,
    p_entity_id: input.entityId,
    p_expires_at: input.expiresAt ?? null,
  });

  if (error || !data) {
    console.error("token store failed", error?.code ?? "no id");
    throw new Error("Could not store that link.");
  }

  return { id: data as string, token: issued.token, hashHex: issued.hashHex };
}

export async function resolveTokenHash(hashHex: string): Promise<ResolvedToken | null> {
  if (!/^[0-9a-f]{64}$/.test(hashHex)) return null;
  const admin = adminOrThrow();
  const { data, error } = await admin.rpc("orbit_resolve_token", { p_token_hash: hashHex });
  if (error) {
    console.error("token resolve failed", error.code);
    throw new Error("Could not resolve that link.");
  }
  return (data as ResolvedToken | null) ?? null;
}

export async function resolveTokenLink(token: string): Promise<ResolvedToken | null> {
  const hashHex = hashOrbitToken(token);
  if (!hashHex) return null;
  return resolveTokenHash(hashHex);
}

export async function revokeTokenLink(id: string) {
  const admin = adminOrThrow();
  const { error } = await admin.rpc("orbit_revoke_token_link", { p_token_link_id: id });
  if (error) {
    console.error("token revoke failed", error.code);
  }
}
