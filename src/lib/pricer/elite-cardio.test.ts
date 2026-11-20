import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { priceInstall } from "./engine";
import type { EffortRow } from "./effort-table";
import { isEliteCardio } from "./elite-cardio";

describe("Elite Cardio HQ build", () => {
  it("recognises the SKU prefix and the product name", () => {
    assert.equal(isEliteCardio("JF-EC-950ET-TFT-21.5", "Something else"), true);
    assert.equal(isEliteCardio("OTHER", "JORDAN Elite Cardio - 805R Recumbent Bike"), true);
    assert.equal(isEliteCardio("JF-C2SE-2", "Concept2 SkiErg"), false);
  });

  it("prices an all-Elite-Cardio order with HQ hours, not zero", () => {
    const result = priceInstall({
      mode: "A",
      postcode: "PE30 4JJ",
      segment: "independent",
      lines: [
        { sku: "JF-EC-950ET-TFT-21.5", productName: "JORDAN Elite Cardio - 950E Treadmill", qty: 2, category: "Treadmills" },
        { sku: "JF-EC-805U-15.6", productName: "JORDAN Elite Cardio - 805U Upright Bike", qty: 1, category: "Bikes" },
      ],
      table: [],
      categoryDefaults: [{ category: "cardio", buildCrew: 2, buildMinutes: 120, note: "site" }],
      pricing: {
        markupIndependent: 0.4,
        markupFranchisee: 0.4,
        markupTrade: 0.5,
        markupBigCorporate: 0.8,
        minJobCharge: null,
        marginFloorPct: null,
        largeOrderThreshold: 50000,
        variationRoundingHours: 0.5,
      },
    });
    assert.equal(result.lines.every((line) => line.row?.buildLocation === "hq"), true);
    assert.equal(result.lines.every((line) => line.row?.hqBuildMinutes === 120 && line.row.hqBuildCrew === 2), true);
    const hours = result.breakdown?.hq?.personHours ?? 0;
    assert.ok(hours > 0, `expected HQ hours, got ${hours}`);
  });

  it("keeps a confirmed site row as the SKU override", () => {
    const override: EffortRow = {
      sku: "JF-EC-805U-15.6",
      productName: "JORDAN Elite Cardio - 805U Upright Bike",
      productLine: null,
      category: "cardio",
      buildLocation: "site",
      crateAtHq: false,
      buildCrew: 2,
      buildMinutes: 90,
      hqBuildCrew: null,
      hqBuildMinutes: null,
      sitePositionMinutes: null,
      complexity: "med",
      carryCrew: 2,
      weightBand: "",
      unitWeightKg: null,
      assembledWeightKg: null,
      assembledDimsMm: null,
      wheeled: "N",
      carryDifficulty: "med",
      pumpTruckOk: false,
      floorFixing: "N",
      reviewFlag: null,
      needsAssembly: true,
      status: "confirmed",
    };
    const result = priceInstall({
      mode: "A",
      postcode: "PE30 4JJ",
      segment: "independent",
      lines: [{ sku: "JF-EC-805U-15.6", productName: override.productName, qty: 1 }],
      table: [override],
      pricing: {
        markupIndependent: 0.4,
        markupFranchisee: 0.4,
        markupTrade: 0.5,
        markupBigCorporate: 0.8,
        minJobCharge: null,
        marginFloorPct: null,
        largeOrderThreshold: 50000,
        variationRoundingHours: 0.5,
      },
    });
    assert.equal(result.lines[0]?.row?.buildLocation, "site");
    assert.equal(result.lines[0]?.row?.buildMinutes, 90);
    assert.equal(result.breakdown?.hq?.personHours ?? 0, 0);
  });
});
