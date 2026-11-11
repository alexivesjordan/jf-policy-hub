import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seesInstallBreakdown } from "./quote-access";

describe("install quote visibility", () => {
  it("keeps the detailed breakdown for an owner, an admin, and an install lead", () => {
    assert.equal(seesInstallBreakdown({ isOwner: true, opsRole: "sales", workspaceRole: "member" }), true);
    assert.equal(seesInstallBreakdown({ workspaceRole: "admin", opsRole: "sales" }), true);
    assert.equal(seesInstallBreakdown({ workspaceRole: "owner" }), true);
    assert.equal(seesInstallBreakdown({ opsRole: "install_lead", workspaceRole: "member" }), true);
    assert.equal(seesInstallBreakdown({ opsRole: "admin_owner", workspaceRole: "member" }), true);
    assert.equal(seesInstallBreakdown({ operations: "edit", opsRole: "sales", workspaceRole: "member" }), true);
  });

  it("hides crew, labour, and internal cost from a sales rep", () => {
    assert.equal(seesInstallBreakdown({ opsRole: "sales", workspaceRole: "member", operations: "none" }), false);
    assert.equal(seesInstallBreakdown({ opsRole: "ops_manager", workspaceRole: "member", operations: "view" }), false);
    assert.equal(seesInstallBreakdown({}), false);
  });
});
