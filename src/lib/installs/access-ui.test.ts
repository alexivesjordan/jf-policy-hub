import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accessChip, kanbanColumn, termsBoxReady } from "./access-ui";

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
  });
});
