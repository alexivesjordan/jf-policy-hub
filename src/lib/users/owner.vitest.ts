import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { onlyUnassigned, ownerLabel } from "./owner";

describe("record owner", () => {
  it("shows Unassigned when the owner is missing", () => {
    expect(ownerLabel(null)).toBe("Unassigned");
    expect(ownerLabel("  ")).toBe("Unassigned");
    expect(ownerLabel("Alex Ives")).toBe("Alex Ives");
  });

  it("filters a list down to rows with no owner", () => {
    const rows = [
      { id: "a", ownerUserId: "user-1" },
      { id: "b", ownerUserId: null },
      { id: "c", ownerUserId: "" },
    ];
    expect(onlyUnassigned(rows, false).map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(onlyUnassigned(rows, true).map((row) => row.id)).toEqual(["b", "c"]);
  });

  it("lets a workspace admin update the profile and fills a job owner from created_by or the install", () => {
    const migration = readFileSync("supabase/migrations/20261124120000_user_deletion_and_owners.sql", "utf8");
    const rollback = readFileSync("supabase/release/r3/user-deletion-rollback.sql", "utf8");
    const deleteFn = migration.slice(migration.indexOf("function public.admin_delete_user"), migration.indexOf("revoke all on function public.admin_delete_user"));
    expect(deleteFn.indexOf("set_config('orbit.profile_sync', 'on', true)")).toBeLessThan(deleteFn.indexOf("update public.profiles"));
    expect(migration).toContain("column_name = 'created_by'");
    expect(migration).toContain("i.owner_user_id");
    expect(rollback).not.toMatch(/'created_at', j\.created_at,\s*\)/);
  });
});