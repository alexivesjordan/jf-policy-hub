import { describe, expect, it } from "vitest";
import { accountMenuItems, settingsRedirect, SETTINGS_NAV, switcherModules } from "@/lib/settings-nav";
import { visibleNav } from "@/lib/shell-nav";
import type { Profile } from "@/lib/types";
import { pulseModules } from "@/modules/registry";

const member = {
  id: "1",
  email: "a@jordanfitness.com",
  full_name: "A",
  role: "staff",
  workspace_role: "member",
  is_active: true,
  access_granted: true,
  last_sign_in_at: null,
  created_at: "",
  updated_at: "",
} as Profile;

const admin = { ...member, workspace_role: "admin" } as Profile;

describe("settings nav", () => {
  it("shows Account to a member and Workspace to an admin", () => {
    const memberNav = visibleNav(SETTINGS_NAV, member, false);
    expect(memberNav.map((item) => item.label)).toEqual(["Account"]);
    expect(memberNav[0]?.children?.map((item) => item.label)).toEqual(["Profile", "Security", "Appearance"]);
    const adminNav = visibleNav(SETTINGS_NAV, admin, false);
    expect(adminNav.map((item) => item.label)).toEqual(["Account", "Workspace"]);
    expect(adminNav[1]?.children?.map((item) => item.href)).toEqual([
      "/settings/workspace/members",
      "/settings/workspace/teams",
      "/settings/workspace/roles",
      "/settings/workspace/org-chart",
    ]);
    const ownerNav = visibleNav(SETTINGS_NAV, { ...admin, workspace_role: "owner" }, true);
    expect(ownerNav[1]?.children?.map((item) => item.href)).toContain("/settings/workspace/security");
  });

  it("keeps My jobs and My signature for field engineers only", () => {
    expect(accountMenuItems(false).map((item) => item.label)).toEqual(["Settings", "Two-step sign-in"]);
    expect(accountMenuItems(true).map((item) => item.label)).toEqual([
      "Settings",
      "Two-step sign-in",
      "My jobs",
      "My signature",
    ]);
  });

  it("hides coming-soon pulses and shows Logistics only when allowed", () => {
    const names = (showLogistics: boolean) => switcherModules(pulseModules, member, showLogistics).map((item) => item.id);
    expect(names(false)).toEqual(["people", "service", "operations", "sales"]);
    expect(names(true)).toEqual(["people", "service", "operations", "sales", "logistics"]);
    expect(names(true)).not.toContain("finance");
  });

  it("sends the old addresses to Settings", () => {
    expect(settingsRedirect("/workspace")).toBe("/settings/workspace");
    expect(settingsRedirect("/workspace/users")).toBe("/settings/workspace/users");
    expect(settingsRedirect("/workspace/teams/extra")).toBe("/settings/workspace/teams/extra");
    expect(settingsRedirect("/account/name")).toBe("/settings/account/profile");
    expect(settingsRedirect("/account/password")).toBe("/settings/account/security");
    expect(settingsRedirect("/account/security")).toBe("/settings/account/security");
    expect(settingsRedirect("/people")).toBeNull();
  });
});
