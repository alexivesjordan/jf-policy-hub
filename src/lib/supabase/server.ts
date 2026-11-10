import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isFixtureMode } from "@/lib/env";
import { createFixtureClient } from "@/lib/supabase/fixture";

export async function createClient() {
  if (isFixtureMode()) return createFixtureClient();
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Supabase is not configured.");
  }

  return createServerClient(url, key, {
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot always write cookies. Proxy refreshes the session.
        }
      },
    },
  });
}
