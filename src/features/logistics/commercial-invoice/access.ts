import { canUseOperations } from "@/lib/access";
import { getCurrentProfile } from "@/lib/auth";
import { fieldRole } from "@/features/field/queries";
import type { Profile } from "@/lib/types";

/** Office and admin only. Field engineers are refused even when they hold operations access. */
export async function requireLogisticsApi(): Promise<{ profile: Profile | null; error: string | null; status: number }> {
  const profile = await getCurrentProfile();
  if (!profile) return { profile: null, error: "Sign in required.", status: 401 };
  if (!profile.access_granted || !profile.is_active) return { profile, error: "You do not have access to this feature.", status: 403 };
  let role = "none";
  try {
    role = await fieldRole();
  } catch {
    return { profile, error: "You do not have access to this feature.", status: 403 };
  }
  if (role === "engineer") return { profile, error: "You do not have access to this feature.", status: 403 };
  const office = profile.workspace_role === "owner"
    || profile.workspace_role === "admin"
    || profile.role === "admin"
    || role === "admin"
    || role === "ops"
    || canUseOperations(profile);
  if (!office) return { profile, error: "You do not have access to this feature.", status: 403 };
  return { profile, error: null, status: 200 };
}
