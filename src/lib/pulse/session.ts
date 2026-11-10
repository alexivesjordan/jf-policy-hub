import "server-only";

import { getCurrentProfile } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

type PulseClient = Awaited<ReturnType<typeof createClient>>;

export async function pulseSession(): Promise<
  | { ok: true; profile: Profile; supabase: PulseClient }
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

/** True for a workspace owner. orbit_is_ops_owner follows workspace_role, not the old install role. */
export async function requireOpsOwner(supabase: PulseClient) {
  const { data, error } = await supabase.rpc("orbit_is_ops_owner");
  if (error) return { ok: false as const, error };
  return { ok: true as const, owner: Boolean(data) };
}
