import type { Profile } from "@/lib/types";

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

export function canUsePeople(profile: Profile) {
  if (!profile.access_granted || !profile.is_active) return false;
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
  return profile.modules?.some((module) => module.module_id === "operations" && module.enabled) ?? false;
}

/** Home screen: People or Operations. People routes still use accessRedirect. */
export function homeRedirect(profile: Profile | null) {
  if (!profile) return "/login";
  if (!profile.access_granted) return "/no-access";
  if (!profile.is_active) return "/account-inactive";
  if (canUsePeople(profile) || canUseOperations(profile)) return null;
  return "/no-access";
}
