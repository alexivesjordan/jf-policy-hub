import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parseCin7CoreQuote } from "../quotes/parse-cin7-core";
import { loadBundledEffortTable } from "./effort-table";
import { forSales, priceInstall, type CategoryEffortDefault } from "./engine";
import { BEST_CASE_NOTICE } from "./rates";

const WORKED_COST = 3718.25;
const WORKED_PRICE = 6692.84;

const MACHINE_DEFAULTS: CategoryEffortDefault[] = ["cardio", "rack-rig", "bench", "strength-selectorised"].map((category) => ({
  category,
  buildCrew: 2,
  buildMinutes: 120,
  note: "Each machine: 2-man, 2-hour build.",
}));

const extracted = parseCin7CoreQuote(
  readFileSync(path.join(process.cwd(), "src/lib/quotes/fixtures/cin7-quote-SO-00490.anonymised.txt"), "utf8"),
);

const lines = extracted.lines.map((line) => ({
  sku: line.sku,
  productName: line.description,
  qty: line.qty,
}));

describe("SO-00490 golden workings", () => {
  const result = priceInstall({
    mode: "A",
    postcode: "IP1 4NJ",
    segment: "big_corporate",
    lines,
    table: loadBundledEffortTable(),
    categoryDefaults: MACHINE_DEFAULTS,
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

  it("classifies the 44 lines the way the workings do", () => {
    assert.equal(extracted.lines.length, 44);
    assert.equal(result.blockedReason, null);
    assert.equal(result.notice, BEST_CASE_NOTICE);
    assert.equal(result.miles, 63.9);
    assert.equal(result.breakdown?.roundTripMiles, 127.8);
    assert.equal(result.breakdown?.speedMph, 35);
    const hq = result.lines.filter((line) => line.match === "dhz_generic");
    const fid = result.lines.filter((line) => line.note === "fallback: FID Bench");
    const loose = result.lines.filter((line) => line.match === "handling_only");
    const machines = result.lines.filter((line) => line.match === "category_default");
    assert.equal(hq.length, 9);
    assert.ok(hq.every((line) => line.row?.buildLocation === "hq" && line.row.hqBuildMinutes === 180));
    assert.equal(fid.length, 1);
    assert.equal(fid[0]?.row?.buildMinutes, 12);
    assert.equal(fid[0]?.row?.buildCrew, 1);
    assert.ok(machines.every((line) => line.row?.buildCrew === 2 && line.row.buildMinutes === 120));
    assert.equal(hq.length + fid.length + loose.length + machines.length, 44);
    assert.equal(result.requirements?.installers, 2);
    assert.equal(result.requirements?.vanSize, "crafter");
    assert.equal(result.requirements?.vanCount, 1);
    assert.equal(forSales(result).customerPrice, result.customerPrice);
    assert.equal("cost" in forSales(result), false);
    assert.equal("breakdown" in forSales(result), false);
    assert.equal(forSales(result).notice, BEST_CASE_NOTICE);
  });

  it("records the remaining gap to £3,718.25 and the 1p customer-price rounding", () => {
    const breakdown = result.breakdown;
    assert.ok(breakdown);
    // Routed mileage and the published crew shape inputs.
    assert.equal(breakdown.roundTripMiles, 127.8);
    assert.equal(breakdown.speedMph, 35);
    assert.equal(breakdown.crew, 2);
    assert.equal(breakdown.vans, 1);
    assert.equal(result.requirements?.vanSize, "crafter");
    // Engine output. 9 × 45 min site position makes 41.30 h on site, so the
    // 8-hour day pack is 6 days / 5 nights, not the workings' 5 days / 4 nights.
    // The generic HQ row is high complexity, so site contingency is 15%.
    assert.equal(breakdown.onSiteHours, 41.3);
    assert.equal(breakdown.days, 6);
    assert.equal(breakdown.nights, 5);
    assert.equal(breakdown.labour, 1371.34);
    assert.equal(breakdown.vehicle, 57.51);
    assert.equal(breakdown.hotel, 800);
    assert.equal(breakdown.food, 180);
    assert.equal(breakdown.freight, 520);
    assert.equal(breakdown.consumables, 6.16);
    assert.equal(Math.round(breakdown.contingencyRate * 100), 15);
    assert.equal(breakdown.siteContingency, 440.25);
    assert.equal(breakdown.siteCost, 3375.26);
    assert.equal(breakdown.hqCost, 888.03);
    assert.equal(result.cost, 4263.29);
    assert.equal(result.customerPrice, 7673.92);
    assert.equal(Math.round((result.cost! - WORKED_COST) * 100) / 100, 545.04);
    assert.equal(Math.round(result.cost! * 1.8 * 100) / 100, 7673.92);
    // The workings' customer price is 1p under cost × 1.8 with this rounding rule.
    assert.equal(Math.round(WORKED_COST * 1.8 * 100) / 100, 6692.85);
    assert.equal(Math.round((6692.85 - WORKED_PRICE) * 100) / 100, 0.01);
    assert.ok(breakdown.bigInstallTriggers.includes("weight_over_2000kg"));
    assert.ok(breakdown.bigInstallTriggers.includes("assembled_dhz"));
  });
});
