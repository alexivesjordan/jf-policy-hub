import "server-only";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

/** True when an owner would have been redirected, and they have not dismissed the banner. */
export async function ownerTwoStepNotice() {
  const store = await cookies();
  if (store.get("pulse-two-step-banner")?.value === "1") return false;
  const supabase = await createClient();
  const trust = store.get("pulse-device")?.value ?? "";
  const [{ data: notice }, trusted] = await Promise.all([
    supabase.rpc("two_step_owner_notice"),
    trust ? supabase.rpc("device_trusted", { p_hash: trust }) : Promise.resolve({ data: false }),
  ]);
  return notice === true && trusted.data !== true;
}
