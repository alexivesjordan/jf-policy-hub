import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seesInstallBreakdown } from "./quote-access";

describe("install quote visibility", () => {
  it("keeps the detailed breakdown for an owner or an admin", () => {
    assert.equal(seesInstallBreakdown({ isOwner: true, opsRole: "sales", workspaceRole: "member" }), true);
    assert.equal(seesInstallBreakdown({ workspaceRole: "admin", opsRole: "sales" }), true);
    assert.equal(seesInstallBreakdown({ workspaceRole: "owner" }), true);
  });

  it("hides crew, labour, and internal cost from everyone else", () => {
    assert.equal(seesInstallBreakdown({ opsRole: "sales", workspaceRole: "member" }), false);
    assert.equal(seesInstallBreakdown({ opsRole: "install_lead", workspaceRole: "member" }), false);
    assert.equal(seesInstallBreakdown({ opsRole: "admin_owner", workspaceRole: "member" }), false);
    assert.equal(seesInstallBreakdown({ opsRole: "ops_manager", workspaceRole: "member" }), false);
    assert.equal(seesInstallBreakdown({}), false);
  });
});
