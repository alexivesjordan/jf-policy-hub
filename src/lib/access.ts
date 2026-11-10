import type { Profile } from "@/lib/types";
import { allows, type AccessLevel } from "@/lib/workspace-access";

export const COMPANY_DOMAIN = "jordanfitness.com";
export const BOOTSTRAP_ADMIN_EMAIL = "alex.ives@jordanfitness.com";

export function normaliseEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isCompanyEmail(email: string) {
  return new RegExp(`^[^@\\s]+@${COMPANY_DOMAIN.replace(".", "\\.")}$`).test(normaliseEmail(email));
}

export function safeNextPath(value: string | null | undefined, fallback = "/") {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  return value;
}

function levelAllows(profile: Profile, moduleId: "people" | "operations" | "sales", need: "view" | "edit") {
  const level = profile.levels?.[moduleId] as AccessLevel | undefined;
  if (!level) return null;
  return allows(level, need);
}

export function canUsePeople(profile: Profile) {
  if (!profile.access_granted || !profile.is_active) return false;
  const resolved = levelAllows(profile, "people", "view");
  if (resolved != null) return resolved;
  if (profile.role === "admin") return true;
  if (!profile.modules) return true;
  return profile.modules.some((module) => module.module_id === "people" && module.enabled);
}

/** Where to send this session, or null when they may use Pulse People. */
export function accessRedirect(profile: Profile | null) {
  if (!profile) return "/login";
  if (!profile.access_granted) return "/no-access";
  if (!profile.is_active) return "/account-inactive";
  if (!canUsePeople(profile)) return "/no-access";
  return null;
}

export function canUseOperations(profile: Profile) {
  if (!profile.access_granted || !profile.is_active) return false;
  const resolved = levelAllows(profile, "operations", "view");
  if (resolved != null) return resolved;
  return profile.modules?.some((module) => module.module_id === "operations" && module.enabled) ?? false;
}

export function canUseSales(profile: Profile) {
  if (!profile.access_granted || !profile.is_active) return false;
  const resolved = levelAllows(profile, "sales", "view");
  if (resolved != null) return resolved;
  if (profile.modules?.some((module) => module.module_id === "sales" && module.enabled)) return true;
  return canUseOperations(profile);
}

export function canManageWorkspace(profile: Profile) {
  return profile.role === "admin" || profile.workspace_role === "owner" || profile.workspace_role === "admin";
}

/** Home screen: People or Operations. People routes still use accessRedirect. */
export function homeRedirect(profile: Profile | null) {
  if (!profile) return "/login";
  if (!profile.access_granted) return "/no-access";
  if (!profile.is_active) return "/account-inactive";
  if (canUsePeople(profile) || canUseOperations(profile) || canUseSales(profile)) return null;
  return "/no-access";
}
