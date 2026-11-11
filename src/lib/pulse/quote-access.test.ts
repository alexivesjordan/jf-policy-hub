import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seesInstallBreakdown } from "./quote-access";

describe("install quote visibility", () => {
  it("keeps the breakdown for an owner, an admin, and an install lead", () => {
    assert.equal(seesInstallBreakdown({ isOwner: true, opsRole: "sales", workspaceRole: "member" }), true);
    assert.equal(seesInstallBreakdown({ workspaceRole: "admin", opsRole: "sales" }), true);
    assert.equal(seesInstallBreakdown({ workspaceRole: "owner" }), true);
    assert.equal(seesInstallBreakdown({ opsRole: "admin_owner" }), true);
    assert.equal(seesInstallBreakdown({ opsRole: "install_lead" }), true);
  });

  it("shows a sales rep the prices only", () => {
    assert.equal(seesInstallBreakdown({ opsRole: "sales", workspaceRole: "member" }), false);
    assert.equal(seesInstallBreakdown({ opsRole: "ops_manager", workspaceRole: "member" }), false);
    assert.equal(seesInstallBreakdown({}), false);
  });
});
