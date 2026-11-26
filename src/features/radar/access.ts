import "server-only";

import { redirect } from "next/navigation";
import { canUseOperations, canUsePeople, moduleAllows } from "@/lib/access";
import { getCurrentProfile } from "@/lib/auth";
import type { Profile } from "@/lib/types";

export async function requireRadarUser() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.access_granted) redirect("/no-access");
  if (!profile.is_active) redirect("/account-inactive");
  if (!moduleAllows(profile, "sales", "view")) {
    redirect(canUsePeople(profile) ? "/people" : canUseOperations(profile) ? "/operations" : "/no-access");
  }
  return profile;
}

export function canEditRadar(profile: Profile) {
  return moduleAllows(profile, "sales", "edit");
}
