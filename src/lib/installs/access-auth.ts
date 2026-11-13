import { moduleAllows } from "@/lib/access";
import type { Profile } from "@/lib/types";

/** The booking rep, an operations editor, or an admin. A field engineer is not an editor. */
export function canManageInstall(profile: Profile, bookingRepId: string | null | undefined) {
  if (!profile.access_granted || !profile.is_active) return false;
  if (profile.workspace_role === "owner" || profile.workspace_role === "admin" || profile.role === "admin") return true;
  if (moduleAllows(profile, "operations", "edit")) return true;
  return Boolean(bookingRepId) && bookingRepId === profile.id;
}

/** Booked or awaiting access only. Field engineers cannot cancel someone else's install. */
export function canCancelInstall(input: {
  profile: Profile;
  bookingRepId: string | null | undefined;
  status: string;
  stage: string;
  fieldEngineer?: boolean;
}) {
  if (input.status === "cancelled") return false;
  if (input.stage !== "booked" && input.stage !== "awaiting_access") return false;
  const admin = input.profile.workspace_role === "owner" || input.profile.workspace_role === "admin" || input.profile.role === "admin";
  const ownBooking = Boolean(input.bookingRepId) && input.bookingRepId === input.profile.id;
  if (input.fieldEngineer && !admin && !ownBooking) return false;
  return canManageInstall(input.profile, input.bookingRepId);
}
