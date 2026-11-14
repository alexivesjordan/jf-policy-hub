import { moduleAllows } from "@/lib/access";
import type { Profile } from "@/lib/types";
import type { ModuleNavItem } from "@/modules/registry";

/** The side nav a field engineer sees. Office and admin keep the full module list. */
export const ENGINEER_NAV: ModuleNavItem[] = [
  { href: "/field", label: "My jobs" },
  { href: "/operations/documents", label: "Visit documents" },
];

export function visibleNav(items: ModuleNavItem[], profile: Profile, isOwner: boolean) {
  return items.filter((item) => {
    if (item.adminOnly && !moduleAllows(profile, "people", "edit")) return false;
    if (item.ownerOnly && !isOwner) return false;
    return true;
  });
}
