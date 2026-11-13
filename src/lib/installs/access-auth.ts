import { moduleAllows } from "@/lib/access";
import type { Profile } from "@/lib/types";

/** The booking rep, someone who can edit operations, or an admin. */
export function canManageInstall(profile: Profile, bookingRepId: string | null | undefined) {
  if (!profile.access_granted || !profile.is_active) return false;
  if (profile.workspace_role === "owner" || profile.workspace_role === "admin" || profile.role === "admin") return true;
  if (moduleAllows(profile, "operations", "edit")) return true;
  return Boolean(bookingRepId) && bookingRepId === profile.id;
}
