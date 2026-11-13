import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { engineerNameFromPerson, newEngineerProblem } from "@/lib/installs/new-engineer";

describe("new field engineer", () => {
  const active = ["Sam Cole", "  ben  "];

  it("defaults the resource name to the person's name", () => {
    expect(engineerNameFromPerson("Sam", "Cole")).toBe("Sam Cole");
    expect(engineerNameFromPerson("  Sam ", " Cole ")).toBe("Sam Cole");
  });

  it("blocks a duplicate of an active engineer, ignoring case and spacing", () => {
    expect(newEngineerProblem({ name: "sam  cole", role: "installer" }, active)).toBe("An active engineer already has that name.");
    expect(newEngineerProblem({ name: "Ben", role: "helper" }, active)).toBe("An active engineer already has that name.");
  });

  it("allows a new name for either resource role", () => {
    expect(newEngineerProblem({ name: "Riley Hart", role: "installer" }, active)).toBeNull();
    expect(newEngineerProblem({ name: "Riley Hart", role: "helper" }, active)).toBeNull();
  });

  it("asks for a name and a real role", () => {
    expect(newEngineerProblem({ name: "  ", role: "installer" }, active)).toBe("Enter the engineer name.");
    expect(newEngineerProblem({ name: "Riley", role: "driver" }, [])).toBe("Choose installer or helper.");
  });

  it("creates and removes the resource in one admin function, with an audit row", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/20261113300000_new_field_engineer.sql", import.meta.url), "utf8");
    expect(sql).toContain("install_create_field_engineer");
    expect(sql).toContain("install_discard_new_engineer");
    expect(sql).toContain("An active engineer already has that name.");
    expect(sql).toContain("resource.created");
    expect(sql).toContain("resource.removed");
    expect(sql).toContain("profile_id is null");
    expect(sql).toContain("ops.is_field_engineer()");
    expect(sql).toContain("workspace_is_admin()");
  });
});
