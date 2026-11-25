import { describe, expect, it } from "vitest";
import { canAddCaseMember, caseOpeningMembers } from "./case-routing";

const directors = ["neil", "deborah"];

describe("case routing", () => {
  it("sends a case about a manager to directors and blocks the chain", () => {
    const opened = caseOpeningMembers({
      route: "manager",
      subjectHasReports: true,
      openerId: "sam",
      directorIds: directors,
      managerId: "simon",
      chainIds: ["simon", "alex"],
    });
    expect(opened.members.sort()).toEqual(["deborah", "neil", "sam"]);
    expect(canAddCaseMember({
      route: "manager",
      subjectHasReports: true,
      profileId: "simon",
      managerId: "simon",
      chainIds: ["simon", "alex"],
    })).toBe(false);
    expect(canAddCaseMember({
      route: "manager",
      subjectHasReports: true,
      profileId: "alex",
      managerId: "simon",
      chainIds: ["simon", "alex"],
    })).toBe(false);
  });

  it("keeps a director-only case off the line manager", () => {
    const opened = caseOpeningMembers({
      route: "director_only",
      subjectHasReports: false,
      openerId: "avery",
      directorIds: directors,
      managerId: "blake",
      chainIds: ["blake"],
    });
    expect(opened.members).toContain("neil");
    expect(opened.members).not.toContain("blake");
    expect(canAddCaseMember({
      route: "director_only",
      subjectHasReports: false,
      profileId: "blake",
      managerId: "blake",
      chainIds: ["blake"],
    })).toBe(false);
  });

  it("does not add a line manager automatically to an ordinary case", () => {
    const opened = caseOpeningMembers({
      route: "manager",
      subjectHasReports: false,
      openerId: "avery",
      directorIds: directors,
      managerId: "blake",
      chainIds: [],
    });
    expect(opened.members).toEqual(["avery"]);
  });
});
