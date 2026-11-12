import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { quoteFailureText, resolveQuoteSegment, salesInstallResult } from "./quote-segment";

describe("install quote segment", () => {
  it("shows a failed load and an unknown order", () => {
    assert.equal(quoteFailureText({ ok: false, message: "Cin7 did not respond." }), "Cin7 did not respond.");
    assert.equal(quoteFailureText({ ok: false, message: "No Cin7 sale has that order number." }), "No Cin7 sale has that order number.");
    assert.equal(quoteFailureText({ ok: false, message: "" }), "Could not price that order.");
  });

  it("asks for a segment, then prices and remembers it, then skips the choice", () => {
    const memory = new Map<string, string>();
    const first = resolveQuoteSegment({ quoteSegment: "", remembered: memory.get("life") ?? "", chosen: "" });
    assert.equal(first.needsChoice, true);
    assert.equal(quoteFailureText({ ok: false, needsSegment: true, message: "" }), null);

    const chosen = resolveQuoteSegment({ quoteSegment: "", remembered: "", chosen: "trade" });
    assert.equal(chosen.needsChoice, false);
    assert.equal(chosen.segment, "trade");
    assert.equal(chosen.remember, true);
    if (chosen.remember) memory.set("life", chosen.segment);

    const again = resolveQuoteSegment({ quoteSegment: "", remembered: memory.get("life") ?? "", chosen: "" });
    assert.deepEqual(again, { segment: "trade", needsChoice: false, remember: false });
  });

  it("gives an owner the same price result as a rep", () => {
    const shared = {
      customerPrice: 4743.62,
      quoteNumber: "SO-00564",
      customerName: "Life Fitness UK",
      postcode: "NR1 1AA",
      flags: ["SECRET-FLAG"],
      breakdown: { hq: { personHours: 8 } },
      lines: [{ sku: "HIDDEN-SKU", qty: 2 }],
      requirements: { installers: 2 },
    };
    const rep = salesInstallResult(shared);
    const owner = salesInstallResult(shared);
    assert.deepEqual(owner, rep);
    assert.equal(owner.showCost, false);
    assert.equal("flags" in owner, false);
    assert.equal("breakdown" in owner, false);
    assert.equal("lines" in owner, false);
    assert.equal(owner.customerPrice, 4743.62);
  });
});
