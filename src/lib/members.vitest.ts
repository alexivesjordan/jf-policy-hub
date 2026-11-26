import { describe, expect, it } from "vitest";
import { memberMatches, memberName, pulseSummary, type MemberRow } from "@/lib/members";

const people: MemberRow[] = [
  {
    id: "1",
    email: "alex@jordanfitness.com",
    full_name: "Alex Ives",
    workspace_role: "owner",
    access_mode: "follow",
    is_active: true,
    teams: [{ id: "t1", name: "Management" }],
    access: [
      { pulse: "people", level: "edit", source: "Owner" },
      { pulse: "operations", level: "edit", source: "Owner" },
      { pulse: "sales", level: "none", source: "Owner" },
    ],
  },
  {
    id: "2",
    email: "sam@jordanfitness.com",
    full_name: "Sam Cole",
    workspace_role: "member",
    access_mode: "custom",
    is_active: false,
    teams: [{ id: "t2", name: "Installs" }],
    access: [{ pulse: "operations", level: "view", source: "Override" }],
  },
];

describe("member list", () => {
  it("labels a pulse with its level and skips none", () => {
    expect(pulseSummary(people[0]?.access)).toBe("People edit, Operations edit");
    expect(pulseSummary(people[1]?.access)).toBe("Operations view");
  });

  it("filters by name, role, team and status", () => {
    expect(memberName(people[1]!)).toBe("Sam Cole");
    expect(people.filter((person) => memberMatches(person, { query: "sam", role: "", team: "", status: "" }))).toHaveLength(1);
    expect(people.filter((person) => memberMatches(person, { query: "", role: "owner", team: "", status: "" }))).toHaveLength(1);
    expect(people.filter((person) => memberMatches(person, { query: "", role: "", team: "Installs", status: "" }))).toHaveLength(1);
    expect(people.filter((person) => memberMatches(person, { query: "", role: "", team: "", status: "inactive" }))).toHaveLength(1);
    expect(people.filter((person) => memberMatches(person, { query: "alex", role: "member", team: "", status: "" }))).toHaveLength(0);
  });
});
