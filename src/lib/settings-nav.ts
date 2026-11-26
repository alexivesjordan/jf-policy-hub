import type { ModuleNavItem } from "@/modules/registry";
import type { Profile } from "@/lib/types";
import type { PulseModule } from "@/modules/registry";

export const SETTINGS_NAV: ModuleNavItem[] = [
  {
    href: "/settings/account",
    label: "Account",
    children: [
      { href: "/settings/account/profile", label: "Profile" },
      { href: "/settings/account/security", label: "Security" },
      { href: "/settings/account/appearance", label: "Appearance" },
    ],
  },
  {
    href: "/settings/workspace",
    label: "Workspace",
    workspaceAdminOnly: true,
    children: [
      { href: "/settings/workspace/members", label: "Members" },
      { href: "/settings/workspace/teams", label: "Teams" },
      { href: "/settings/workspace/roles", label: "Roles" },
    ],
  },
];

export type AccountMenuItem = { href: string; label: string };

/** Avatar menu links. Theme and Sign out are always shown beside these. */
export function accountMenuItems(fieldEngineer: boolean): AccountMenuItem[] {
  const items: AccountMenuItem[] = [
    { href: "/settings", label: "Settings" },
    { href: "/settings/account/security", label: "Two-step sign-in" },
  ];
  if (fieldEngineer) {
    items.push({ href: "/field", label: "My jobs" }, { href: "/field/signature", label: "My signature" });
  }
  return items;
}

/** Pulses shown in the switcher and on the home launcher. Coming-soon pulses stay hidden. */
export function switcherModules(modules: PulseModule[], profile: Profile | null, showLogistics: boolean) {
  return modules.filter((module) => {
    if (module.status === "coming-soon") return false;
    if (module.id === "logistics" && !showLogistics) return false;
    if (!profile?.levels) return true;
    const level = profile.levels[module.id as keyof NonNullable<Profile["levels"]>];
    return level !== "none";
  });
}

/** Old Workspace and Account addresses. Password setup still lands on Security. */
export function settingsRedirect(pathname: string): string | null {
  if (pathname === "/workspace" || pathname.startsWith("/workspace/")) return `/settings${pathname}`;
  if (pathname === "/account/name") return "/settings/account/profile";
  if (pathname === "/account/password" || pathname === "/account/security") return "/settings/account/security";
  if (pathname.startsWith("/account/")) return "/settings/account/profile";
  return null;
}
