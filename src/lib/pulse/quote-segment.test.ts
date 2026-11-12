import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canLoadQuote, quoteFailureText, resolveQuoteSegment, salesInstallResult, salesOrderActionResult } from "./quote-segment";

describe("install quote segment", () => {
  it("shows a failed load and an unknown order", () => {
    assert.equal(quoteFailureText({ ok: false, message: "Cin7 did not respond." }), "Cin7 did not respond.");
    assert.equal(quoteFailureText({ ok: false, message: "No Cin7 sale has that order number." }), "No Cin7 sale has that order number.");
    assert.equal(quoteFailureText({ ok: false, message: "" }), "Could not price that order.");
  });

  it("stays disabled until the order number and segment are both filled", () => {
    assert.equal(canLoadQuote("", "trade"), false);
    assert.equal(canLoadQuote("SO-00564", ""), false);
    assert.equal(canLoadQuote("  ", "trade"), false);
    assert.equal(canLoadQuote("SO-00564", "trade"), true);
  });

  it("uses the latest choice and overwrites the stored segment", () => {
    assert.equal(resolveQuoteSegment("").needsChoice, true);
    const stored = "independent";
    const chosen = resolveQuoteSegment("trade");
    assert.equal(chosen.needsChoice, false);
    assert.equal(chosen.segment, "trade");
    assert.equal(chosen.remember, true);
    assert.notEqual(chosen.segment, stored);
    const again = resolveQuoteSegment("big_corporate");
    assert.deepEqual(again, { segment: "big_corporate", needsChoice: false, remember: true });
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

  it("serializes the action result without lines, SKUs, flags, or cost", () => {
    const result = salesOrderActionResult({
      ok: true,
      message: "Install price ready.",
      needsSegment: false,
      quoteNumber: "SO-00564",
      customerName: "Life Fitness UK",
      postcode: "NR1 1AA",
      customerPrice: 4743.62,
      savedQuoteId: "quote-1",
      service: {
        id: "svc-1",
        quoteNumber: "SO-00564",
        customerName: "Life Fitness UK",
        rateVersion: "v1",
        prices: [{
          name: "Site",
          prices: { annualPm: 1895, twiceYearlyPm: 3495, extendedWarrantyOneOff: 0, annualBundleYear1: null, twiceBundleYear1: null },
        }],
      },
      draft: {
        lines: [{ sku: "HIDDEN-SKU", qty: 2, description: "HIDDEN-PRODUCT" }],
        flags: ["SECRET-FLAG"],
        cost: 1200,
        breakdown: { hq: { personHours: 8 } },
      },
      flags: ["SECRET-FLAG"],
      cost: 1200,
      lineItems: [{ sku: "HIDDEN-SKU", quantity: 2 }],
    } as Parameters<typeof salesOrderActionResult>[0]);
    const json = JSON.stringify(result);
    for (const secret of ["HIDDEN-SKU", "HIDDEN-PRODUCT", "SECRET-FLAG", "draft", "lineItems", "breakdown", "qty", "sku", "flags", "cost"]) {
      assert.equal(json.includes(secret), false, secret);
    }
    assert.equal(json.includes("Life Fitness UK"), true);
    assert.equal(json.includes("4743.62"), true);
    assert.equal(json.includes("quote-1"), true);
    assert.equal(result.needsSegment, false);
  });
});
