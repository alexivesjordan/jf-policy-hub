"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runSupplySyncJob } from "@/lib/supply/sync-job";

export async function refreshSupplyNow() {
  const supabase = await createClient();
  const allowed = await supabase.rpc("supply_assert_admin");
  if (allowed.error) throw new Error("Only a supply admin can refresh Cin7.");
  const result = await runSupplySyncJob();
  revalidatePath("/supply");
  if (result.error) throw new Error(result.error);
}
