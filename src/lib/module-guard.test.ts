import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { moduleAllows } from "./access";
import { hasLevel } from "./module-guard";
import type { Profile } from "./types";

function profile(partial: Partial<Profile>): Profile {
  return {
    id: "1",
    email: "a@jordanfitness.com",
    full_name: "A",
    role: "staff",
    is_active: true,
    access_granted: true,
    last_sign_in_at: null,
    created_at: "",
    updated_at: "",
    ...partial,
  };
}

describe("module access guards", () => {
  it("lets an owner through every module", () => {
    const owner = profile({
      workspace_role: "owner",
      levels: { operations: "none", sales: "none", people: "none" },
    });
    assert.equal(moduleAllows(owner, "operations", "edit"), true);
    assert.equal(moduleAllows(owner, "finance", "view"), true);
  });

  it("treats view as read-only and edit as write", () => {
    const viewer = profile({ levels: { operations: "view", sales: "edit" } });
    assert.equal(moduleAllows(viewer, "operations", "view"), true);
    assert.equal(moduleAllows(viewer, "operations", "edit"), false);
    assert.equal(moduleAllows(viewer, "sales", "edit"), true);
  });

  it("does not fall through to the old module switch when a level is set", () => {
    const blocked = profile({
      levels: { operations: "none" },
      modules: [{ module_id: "operations", enabled: true }],
    });
    assert.equal(moduleAllows(blocked, "operations", "view"), false);
  });

  it("reads office context levels, with owner covering a missing level", () => {
    assert.equal(hasLevel("edit", "edit"), true);
    assert.equal(hasLevel("view", "edit"), false);
    assert.equal(hasLevel("view", "view"), true);
    assert.equal(hasLevel(undefined, "edit", true), true);
  });
});
