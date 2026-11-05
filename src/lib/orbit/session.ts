import "server-only";

import { getCurrentProfile } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

type OrbitClient = Awaited<ReturnType<typeof createClient>>;

export async function orbitSession(): Promise<
  | { ok: true; profile: Profile; supabase: OrbitClient }
  | { ok: false; response: Response }
> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      response: Response.json({ error: "Supabase is not configured." }, { status: 500 }),
    };
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    return {
      ok: false,
      response: Response.json({ error: "You need to be signed in." }, { status: 401 }),
    };
  }
  if (!profile.access_granted || !profile.is_active) {
    return {
      ok: false,
      response: Response.json({ error: "You do not have access." }, { status: 403 }),
    };
  }

  return { ok: true, profile, supabase: await createClient() };
}

export async function requireOpsOwner(supabase: OrbitClient) {
  const { data, error } = await supabase.rpc("orbit_is_ops_owner");
  if (error) return { ok: false as const, error };
  return { ok: true as const, owner: Boolean(data) };
}

export async function requireOpsRole(supabase: OrbitClient, roles: string[]) {
  const { data, error } = await supabase.rpc("orbit_has_ops_role", { p_roles: roles });
  if (error) return { ok: false as const, error };
  return { ok: true as const, allowed: Boolean(data) };
}
