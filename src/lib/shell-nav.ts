import { moduleAllows } from "@/lib/access";
import type { Profile } from "@/lib/types";
import type { ModuleNavItem } from "@/modules/registry";

/** The side nav a field engineer sees. Office and admin keep the full module list. */
export const ENGINEER_NAV: ModuleNavItem[] = [
  { href: "/field", label: "My jobs" },
  { href: "/operations/documents", label: "Visit documents" },
];

const EXACT_NAV = new Set(["/dashboard", "/operations", "/sales", "/workspace", "/people"]);

export function navItemActive(href: string, path: string) {
  if (EXACT_NAV.has(href)) return path === href;
  return path === href || path.startsWith(`${href}/`);
}

export function visibleNav(items: ModuleNavItem[], profile: Profile, isOwner: boolean): ModuleNavItem[] {
  const visible: ModuleNavItem[] = [];
  for (const item of items) {
    if (item.adminOnly && !moduleAllows(profile, "people", "edit")) continue;
    if (item.ownerOnly && !isOwner) continue;
    if (item.children) {
      const children = visibleNav(item.children, profile, isOwner);
      if (children.length === 0) continue;
      visible.push({ ...item, children });
      continue;
    }
    visible.push(item);
  }
  return visible;
}
