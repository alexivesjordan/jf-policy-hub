import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { canCancelInstall, closedInstallMessage } from "./access-auth";
import { messageFromError } from "../errors";
import type { Profile } from "../types";

function person(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "rep-1",
    email: "rep@jordanfitness.com",
    full_name: "Rep",
    role: "staff",
    is_active: true,
    access_granted: true,
    last_sign_in_at: null,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    workspace_role: "member",
    levels: { sales: "edit", operations: "none" },
    ...overrides,
  };
}

describe("cancel a booked install", () => {
  it("lets a rep cancel their own booking but not another rep's", () => {
    const rep = person();
    assert.equal(canCancelInstall({ profile: rep, bookingRepId: "rep-1", status: "booked", stage: "booked" }), true);
    assert.equal(canCancelInstall({ profile: rep, bookingRepId: "rep-1", status: "booked", stage: "awaiting_access" }), true);
    assert.equal(canCancelInstall({ profile: rep, bookingRepId: "rep-1", status: "quoting", stage: "quoting" }), true);
    assert.equal(canCancelInstall({ profile: rep, bookingRepId: "rep-2", status: "booked", stage: "booked" }), false);
  });

  it("refuses a field engineer even when they can edit operations", () => {
    const engineer = person({
      id: "eng-1",
      levels: { operations: "edit", sales: "view" },
    });
    assert.equal(canCancelInstall({
      profile: engineer,
      bookingRepId: "rep-1",
      status: "booked",
      stage: "awaiting_access",
      fieldEngineer: true,
    }), false);
  });

  it("lets an operations editor or an admin cancel, and hides the action once it is ready or cancelled", () => {
    const editor = person({ id: "ops-1", levels: { operations: "edit", sales: "view" } });
    assert.equal(canCancelInstall({ profile: editor, bookingRepId: "rep-1", status: "booked", stage: "booked" }), true);
    assert.equal(canCancelInstall({ profile: person({ role: "admin", workspace_role: "admin" }), bookingRepId: "rep-1", status: "booked", stage: "awaiting_access" }), true);
    assert.equal(canCancelInstall({ profile: editor, bookingRepId: "rep-1", status: "booked", stage: "ready" }), false);
    assert.equal(canCancelInstall({ profile: editor, bookingRepId: "rep-1", status: "cancelled", stage: "booked" }), false);
  });

  it("revokes access and visit links and frees the reservations", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/20261113280000_install_cancel.sql", import.meta.url), "utf8");
    assert.match(sql, /delete from ops\.install_reservations where install_id = p_id/);
    assert.match(sql, /purpose in \('access_form', 'subcontractor_job'\)/);
    assert.match(sql, /set revoked_at = coalesce\(revoked_at, now\(\)\)/);
    assert.match(sql, /jsonb_build_object\('reason', p_reason\)/);
    assert.match(sql, /ops\.is_field_engineer\(\)/);
    assert.match(sql, /install_claim_engineer\(\)/);
    assert.match(sql, /Award the subcontractor quote before changing the status/);
    assert.match(sql, /update ops\.install_quotes set install_id = null where install_id = p_id/);
    assert.equal(sql.includes("caller_is_field_engineer"), false);
    assert.equal(/sendPulseEmail|deliverPulseEmail|resend\.com/.test(sql), false);
  });

  it("refuses a new link once the install is closed", () => {
    assert.equal(closedInstallMessage("cancelled"), "This install is cancelled.");
    assert.equal(closedInstallMessage("completed"), "This install is completed.");
    assert.equal(closedInstallMessage("booked"), null);
  });

  it("turns a stale quote booking into a reload message", () => {
    const raw = 'duplicate key value violates unique constraint "installs_quote_id_key"';
    assert.equal(messageFromError({ message: raw }, "Could not book that install."), "This quote has changed. Reload the order.");
  });

  it("extends the access token when the install dates move", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/20261113290000_access_token_on_move.sql", import.meta.url), "utf8");
    assert.match(sql, /purpose = 'access_form'/);
    assert.match(sql, /expires_at = \(v_end::timestamp \+ time '23:59:59'\) at time zone 'UTC'/);
    assert.match(sql, /ops\.is_field_engineer\(\)/);
    assert.match(sql, /Award the subcontractor quote before moving dates/);
    assert.match(sql, /v_weekends boolean := false/);
    assert.match(sql, /install_assert_linkable/);
    assert.match(sql, /This install is cancelled/);
    assert.match(sql, /This install is completed/);
  });
});
