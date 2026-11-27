import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OFFBOARDING_TEMPLATE,
  ONBOARDING_TEMPLATE,
  ONBOARDING_WINDOW_DAYS,
  checklistDueOn,
  checklistItemHref,
  expandTemplate,
  formatLondonDate,
  formatLondonWhen,
  joinerEngineerProblem,
  joinerProblem,
  shiftDue,
} from "@/lib/hr/checklists";

describe("checklist due dates", () => {
  it("rolls a weekend forward when the offset is zero or positive", () => {
    expect(shiftDue("2026-11-28", 0)).toBe("2026-11-30");
    expect(shiftDue("2026-11-30", 5)).toBe("2026-12-07");
    expect(shiftDue("2026-11-30", 1)).toBe("2026-12-01");
  });

  it("rolls a weekend back when the task is due before the anchor", () => {
    expect(shiftDue("2026-12-18", -5)).toBe("2026-12-11");
    expect(shiftDue("2026-12-18", -1)).toBe("2026-12-17");
  });

  it("sets the onboarding checklist due a fortnight after the start, on a weekday", () => {
    expect(ONBOARDING_WINDOW_DAYS).toBe(14);
    expect(checklistDueOn("onboarding", "2026-11-30")).toBe("2026-12-14");
    expect(checklistDueOn("offboarding", "2026-12-18")).toBe("2026-12-18");
  });

  it("shows dates and done times in Europe/London", () => {
    expect(formatLondonDate("2026-12-07")).toBe("7 Dec 2026");
    expect(formatLondonWhen("2026-11-27T09:30:00Z")).toBe("27 Nov 2026, 09:30");
  });
});

describe("template expansion", () => {
  it("keeps the engineer item for field staff only", () => {
    const office = expandTemplate(ONBOARDING_TEMPLATE, { anchor: "2026-11-30", location: "office" });
    const field = expandTemplate(ONBOARDING_TEMPLATE, { anchor: "2026-11-30", location: "field" });
    expect(office.map((item) => item.label)).not.toContain("Engineer record");
    expect(office).toHaveLength(7);
    expect(field).toHaveLength(8);
    expect(field.at(-1)?.linkKind).toBe("engineer_record");
    expect(field.find((item) => item.label === "H&S induction")?.dueOn).toBe("2026-12-07");
    expect(field.find((item) => item.label === "Engineer record")?.dueOn).toBe("2026-12-01");
  });

  it("drops the engineer item from offboarding unless the person is field staff", () => {
    const office = expandTemplate(OFFBOARDING_TEMPLATE, { anchor: "2026-12-18", location: "warehouse" });
    const field = expandTemplate(OFFBOARDING_TEMPLATE, { anchor: "2026-12-18", location: "field" });
    expect(office.map((item) => item.label)).not.toContain("Engineer record inactive");
    expect(field.find((item) => item.label === "Holiday balance settled")?.dueOn).toBe("2026-12-11");
    expect(field.find((item) => item.label === "Pulse login deactivated")?.linkKind).toBe("deactivate_login");
  });

  it("matches the seeded template labels", () => {
    const sql = readFileSync("supabase/migrations/20261129200000_hr_joiners_leavers.sql", "utf8");
    for (const item of [...ONBOARDING_TEMPLATE, ...OFFBOARDING_TEMPLATE]) {
      expect(sql).toContain(item.label);
    }
    expect(sql).toContain("then 14 else 0");
  });
});

describe("engineer link", () => {
  it("reuses the new engineer checks", () => {
    expect(joinerEngineerProblem(
      { installEngineer: true, location: "field", name: "sam  cole", role: "installer" },
      ["Sam Cole"],
    )).toBe("An active engineer already has that name.");
    expect(joinerEngineerProblem(
      { installEngineer: true, location: "field", name: "Riley", role: "driver" },
      [],
    )).toBe("Choose installer or helper.");
    expect(joinerEngineerProblem(
      { installEngineer: true, location: "office", name: "Riley Hart", role: "installer" },
      [],
    )).toBe("Install engineers are field staff.");
    expect(joinerEngineerProblem(
      { installEngineer: false, location: "office", name: "", role: "" },
      [],
    )).toBeNull();
  });

  it("rejects a joiner before an engineer is created", () => {
    expect(joinerProblem({
      fullName: "  ",
      location: "field",
      startDate: "2026-11-30",
      workEmail: "",
      hours: "40",
      installEngineer: true,
      engineerRole: "installer",
    }, [])).toBe("Enter the person's name.");
    expect(joinerProblem({
      fullName: "Riley Hart",
      location: "field",
      startDate: "2026-11-30",
      workEmail: "not-an-email",
      hours: "40",
      installEngineer: false,
      engineerRole: "installer",
    }, [])).toBe("Check the work email.");
  });

  it("points each checklist link at the existing screen", () => {
    const person = { profileId: "11111111-1111-4111-8111-111111111111", engineerResourceId: "22222222-2222-4222-8222-222222222222" };
    expect(checklistItemHref("pulse_invite", person)?.href).toBe("/settings/workspace/members");
    expect(checklistItemHref("teams", person)?.href).toBe("/settings/workspace/teams");
    expect(checklistItemHref("deactivate_login", person)?.href).toBe("/settings/workspace/members/11111111-1111-4111-8111-111111111111");
    expect(checklistItemHref("deactivate_login", { profileId: null })?.href).toBe("/settings/workspace/members");
    expect(checklistItemHref("engineer_record", person)?.href).toBe("/operations/schedule");
    expect(checklistItemHref("engineer_record", { engineerResourceId: null })).toBeNull();
    expect(checklistItemHref("none", person)).toBeNull();
  });
});
