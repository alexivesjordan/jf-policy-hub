import { moduleAllows } from "@/lib/access";
import type { Profile } from "@/lib/types";

/** The booking rep, an operations editor, or an admin. A field engineer is not an editor. */
export function canManageInstall(profile: Profile, bookingRepId: string | null | undefined) {
  if (!profile.access_granted || !profile.is_active) return false;
  if (profile.workspace_role === "owner" || profile.workspace_role === "admin" || profile.role === "admin") return true;
  if (moduleAllows(profile, "operations", "edit")) return true;
  return Boolean(bookingRepId) && bookingRepId === profile.id;
}

/** Booked, awaiting access, or a quoting subcontractor install. Field engineers cannot cancel. */
export function canCancelInstall(input: {
  profile: Profile;
  bookingRepId: string | null | undefined;
  status: string;
  stage: string;
  fieldEngineer?: boolean;
}) {
  if (input.status === "cancelled") return false;
  if (input.stage !== "booked" && input.stage !== "awaiting_access" && input.stage !== "quoting") return false;
  const admin = input.profile.workspace_role === "owner" || input.profile.workspace_role === "admin" || input.profile.role === "admin";
  if (input.fieldEngineer && !admin) return false;
  return canManageInstall(input.profile, input.bookingRepId);
}

/** Closed installs must not mint a new access or visit link, or send another email. */
export function closedInstallMessage(status: unknown) {
  if (status === "cancelled") return "This install is cancelled.";
  if (status === "completed") return "This install is completed.";
  return null;
}
