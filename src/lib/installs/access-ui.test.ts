import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accessChip, answerText, basisText, firstFilledKanban, installCoversDay, kanbanAccessChip, kanbanColumn, orderedAnswers, termsBoxReady } from "./access-ui";

describe("install access UI", () => {
  it("names the access chip from what has been sent", () => {
    assert.equal(accessChip(null), "Not sent");
    assert.equal(accessChip({ sentAt: "2026-11-01" }), "Sent");
    assert.equal(accessChip({ sentAt: "2026-11-01", submittedAt: "2026-11-02", mediaCount: 0 }), "Submitted");
    assert.equal(accessChip({ submittedAt: "2026-11-02", mediaCount: 2 }), "Submitted");
  });

  it("treats a charges box that does not scroll as already read", () => {
    assert.equal(termsBoxReady(80, 256, false), true);
    assert.equal(termsBoxReady(800, 256, false), false);
    assert.equal(termsBoxReady(800, 256, true), true);
  });

  it("puts an unknown stage in Booked and keeps quoting for later", () => {
    assert.equal(kanbanColumn("awaiting_access"), "awaiting_access");
    assert.equal(kanbanColumn("quoting"), "quoting");
    assert.equal(kanbanColumn("mystery"), "booked");
    assert.equal(firstFilledKanban(["ready", "booked"]), "booked");
    assert.equal(firstFilledKanban([]), null);
    assert.equal(kanbanAccessChip("awaiting_access", 0), "Awaiting form");
    assert.equal(kanbanAccessChip("ready", 2), "Submitted");
    assert.equal(kanbanAccessChip("ready", 0), "No photos");
    assert.equal(kanbanAccessChip("booked", 0), null);
  });

  it("names every charges basis in plain words", () => {
    assert.equal(basisText("cost_plus_25"), "Cost + 25%");
    assert.equal(basisText("additional_installer_time"), "Charged as additional installer time");
    assert.equal(basisText("at_cost"), "At cost");
    assert.equal(basisText("tbc"), "To be confirmed");
    assert.equal(basisText("site_survey"), "site survey");
  });

  it("shows answers in form order, as Yes or No, and skips blanks", () => {
    assert.equal(answerText(true), "Yes");
    assert.equal(answerText(false), "No");
    assert.equal(answerText(""), null);
    const rows = orderedAnswers({ dropZone: "Front car park", groundFloor: true, floorNumber: null, hasLift: false });
    assert.deepEqual(rows.map((row) => row.label), ["Ground floor", "Lift", "Drop zone"]);
    assert.deepEqual(rows.map((row) => row.text), ["Yes", "No", "Front car park"]);
  });

  it("keeps a multi-day install off Saturday and Sunday", () => {
    assert.equal(installCoversDay("2026-11-13", "2026-11-16", "2026-11-13"), true);
    assert.equal(installCoversDay("2026-11-13", "2026-11-16", "2026-11-14"), false);
    assert.equal(installCoversDay("2026-11-13", "2026-11-16", "2026-11-15"), false);
    assert.equal(installCoversDay("2026-11-13", "2026-11-16", "2026-11-16"), true);
  });
});
