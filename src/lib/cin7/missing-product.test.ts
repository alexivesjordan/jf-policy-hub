import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fillMissingSkuCategories, productHit } from "./missing-product";

describe("missing Cin7 product lookup", () => {
  it("reads the category from a product payload", () => {
    const hit = productHit({
      Products: [{ ID: "33333333-3333-4333-8333-333333333333", SKU: "JF-EC-950ET-TFT-21.5", Name: "Treadmill", Category: "Treadmills", Status: "Deprecated" }],
    });
    assert.equal(hit?.sku, "JF-EC-950ET-TFT-21.5");
    assert.equal(hit?.category, "Treadmills");
  });

  it("looks up only SKUs missing from the effort table", async () => {
    const calls: string[] = [];
    const result = await fillMissingSkuCategories(
      [
        { sku: "KNOWN", productId: "11111111-1111-4111-8111-111111111111", category: "" },
        { sku: "JF-PS-1", productId: "22222222-2222-4222-8222-222222222222", category: "" },
      ],
      new Set(["KNOWN"]),
      async (productId) => {
        calls.push(productId);
        return { Products: [{ ID: productId, SKU: "JF-PS-1", Name: "Pin loaded", Category: "Strength Machines" }] };
      },
    );
    assert.deepEqual(calls, ["22222222-2222-4222-8222-222222222222"]);
    assert.equal(result.lines[1]?.category, "Strength Machines");
    assert.equal(result.lines[0]?.category, "");
    assert.equal(result.found[0]?.category, "Strength Machines");
  });
});