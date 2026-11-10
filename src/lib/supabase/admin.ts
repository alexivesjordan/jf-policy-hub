import "server-only";

import { createClient } from "@supabase/supabase-js";
import { isFixtureMode } from "@/lib/env";
import { createFixtureClient } from "@/lib/supabase/fixture";

export function createAdminClient() {
  if (isFixtureMode()) return createFixtureClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
