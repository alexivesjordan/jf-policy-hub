import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyWorkspaceRole, mostPermissive, resolveModuleAccess } from "./workspace-access";

describe("workspace access", () => {
  it("uses the most permissive team grant", () => {
    assert.equal(mostPermissive(["none", "view", "edit"]), "edit");
    assert.equal(mostPermissive([]), "none");
  });

  it("gives the owner edit everywhere and caps a viewer", () => {
    assert.equal(applyWorkspaceRole("owner", "none"), "edit");
    assert.equal(applyWorkspaceRole("admin", "view"), "edit");
    assert.equal(applyWorkspaceRole("viewer", "edit"), "view");
    assert.equal(applyWorkspaceRole("viewer", "none"), "none");
    assert.equal(applyWorkspaceRole("manager", "none"), "view");
    assert.equal(applyWorkspaceRole("member", "edit"), "edit");
    assert.equal(applyWorkspaceRole("member", "none"), "none");
  });

  it("keeps a custom grid and otherwise follows the team and role", () => {
    assert.equal(resolveModuleAccess({
      accessMode: "custom",
      role: "owner",
      teamGrants: ["none"],
      custom: "none",
    }), "edit");
    assert.equal(resolveModuleAccess({
      accessMode: "custom",
      role: "admin",
      teamGrants: ["edit"],
      custom: "none",
    }), "none");
    assert.equal(resolveModuleAccess({
      accessMode: "follow",
      role: "member",
      teamGrants: ["view", "edit"],
      custom: "none",
    }), "edit");
    assert.equal(resolveModuleAccess({
      accessMode: "follow",
      role: "owner",
      teamGrants: [],
      custom: null,
    }), "edit");
  });
});
