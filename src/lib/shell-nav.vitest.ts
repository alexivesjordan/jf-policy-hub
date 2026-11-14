import { describe, expect, it } from "vitest";
import { ENGINEER_NAV, navItemActive, visibleNav } from "@/lib/shell-nav";
import type { Profile } from "@/lib/types";
import { pulseModules } from "@/modules/registry";

const profile = {
  id: "1",
  email: "a@jordanfitness.com",
  full_name: "A",
  role: "staff",
  is_active: true,
  access_granted: true,
  last_sign_in_at: null,
  created_at: "",
  updated_at: "",
} as Profile;

describe("module nav", () => {
  it("keeps My jobs exact so tasks and the calendar are separate", () => {
    expect(navItemActive("/field", "/field")).toBe(true);
    expect(navItemActive("/field", "/field/tasks")).toBe(false);
    expect(navItemActive("/field/tasks", "/field/tasks")).toBe(true);
    expect(ENGINEER_NAV.map((item) => item.label)).toEqual(["My jobs", "My tasks", "Calendar"]);
  });

  it("treats overview routes as exact", () => {
    expect(navItemActive("/sales", "/sales")).toBe(true);
    expect(navItemActive("/sales", "/sales/installs")).toBe(false);
    expect(navItemActive("/sales/installs", "/sales/installs/abc")).toBe(true);
    expect(navItemActive("/sales/quote", "/sales/quote")).toBe(true);
  });

  it("groups office setup and drops the old jobs links", () => {
    const operations = visibleNav(pulseModules.find((module) => module.id === "operations")?.nav ?? [], profile, true);
    expect(operations.map((item) => item.label)).toEqual(["Overview", "Schedule", "Installs", "Fleet", "Tasks", "Setup"]);
    expect(operations.find((item) => item.label === "Setup")?.children?.map((item) => item.label)).toEqual([
      "Subcontractors",
      "Effort tables",
      "Gate overrides",
      "Visit documents",
    ]);
  });

  it("sends People to Overview, Calendar, and Policies", () => {
    const people = visibleNav(pulseModules.find((module) => module.id === "people")?.nav ?? [], profile, true);
    expect(people.map((item) => item.label)).toEqual(["Overview", "Calendar", "Policies"]);
    expect(people.map((item) => item.href)).toEqual(["/people", "/people/calendar", "/policies"]);
  });

  it("keeps Quotes as a parent over the existing quote pages", () => {
    const sales = visibleNav(pulseModules.find((module) => module.id === "sales")?.nav ?? [], profile, false);
    expect(sales.map((item) => item.label)).toEqual(["Overview", "Installs", "Quotes"]);
    expect(sales.find((item) => item.label === "Quotes")?.children?.map((item) => item.label)).toEqual([
      "Install quoting",
      "Warranties & servicing",
    ]);
  });
});
