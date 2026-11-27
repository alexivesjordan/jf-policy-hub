"use server";

import { createClient } from "@/lib/supabase/server";
import { runSupplySyncJob } from "@/lib/supply/sync-job";

export async function refreshSupplyNow() {
  const supabase = await createClient();
  const allowed = await supabase.rpc("supply_assert_admin");
  if (allowed.error) return { error: "Only a supply admin can refresh Cin7." };
  const result = await runSupplySyncJob();
  if (result.error) return { error: result.error };
  return { calls: result.calls, phase: result.phase, done: result.done };
}
