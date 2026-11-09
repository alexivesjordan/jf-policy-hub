import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effortRowForSku, priceInstall, DEFAULT_PRICING } from "./engine";
import { tilesFromSale, tilesPerPackFromProduct } from "./flooring";

describe("flooring quantities", () => {
  it("keeps a tile or each quantity", () => {
    assert.equal(tilesFromSale({ qty: 200, uom: "Tile", length: null, width: null, dimensionUnit: null, tilesPerPack: null }).tiles, 200);
    assert.equal(tilesFromSale({ qty: 40, uom: "Each", length: null, width: null, dimensionUnit: null, tilesPerPack: null }).assumed, false);
  });

  it("converts square metres with a centimetre tile size", () => {
    const result = tilesFromSale({ qty: 10, uom: "m2", length: 50, width: 50, dimensionUnit: "cm", tilesPerPack: null });
    assert.equal(result.tiles, 40);
    assert.equal(result.assumed, false);
  });

  it("uses tiles per pack and flags a pack that has no count", () => {
    assert.equal(tilesPerPackFromProduct({ TilesPerPack: 8 }), 8);
    const pack = tilesFromSale({ qty: 3, uom: "Pack", length: null, width: null, dimensionUnit: null, tilesPerPack: 8 });
    assert.equal(pack.tiles, 24);
    const missing = tilesFromSale({ qty: 3, uom: "Box", length: null, width: null, dimensionUnit: null, tilesPerPack: null });
    assert.equal(missing.tiles, 3);
    assert.match(missing.detail ?? "", /tiles-per-pack/);
  });
});

describe("floor and sled sequencing", () => {
  it("lays 200 tiles in an 8-hour day and puts the sled track afterwards", () => {
    const floor = effortRowForSku({
      sku: "TILE",
      productName: "Rubber tile",
      category: "Gym Flooring",
      needsAssembly: true,
      crew: 2,
      buildMinutes: 2.4,
      buildLocation: "site",
      effortUnit: "tile",
    });
    const sled = effortRowForSku({
      sku: "SLED",
      productName: "Sled track",
      category: "Sleds",
      needsAssembly: true,
      crew: 2,
      buildMinutes: 180,
      buildLocation: "site",
      effortUnit: "each",
      workPhase: "sled",
    });
    const result = priceInstall({
      mode: "A",
      postcode: "NR1 1AA",
      miles: 10,
      segment: "independent",
      lines: [
        { sku: "TILE", productName: "Rubber tile", category: "Gym Flooring", qty: 200, billableUnits: 200 },
        { sku: "SLED", productName: "Sled track", category: "Sleds", qty: 1 },
      ],
      table: [floor, sled],
      pricing: DEFAULT_PRICING,
    });
    assert.equal(result.blockedReason, null);
    assert.ok(result.flags.some((flag) => /after flooring/.test(flag)));
    const prep = 45;
    const floorMinutes = 200 * 2.4;
    const sledMinutes = 180;
    assert.ok(result.breakdown);
    assert.ok(Math.abs(result.breakdown.onSiteHours - (prep + floorMinutes + sledMinutes) / 60) < 0.05);
  });
});
