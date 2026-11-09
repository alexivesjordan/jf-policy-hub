import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parseCin7CoreQuote } from "../quotes/parse-cin7-core";
import { loadBundledEffortTable } from "./effort-table";
import { forSales, priceInstall, type CategoryEffortDefault } from "./engine";
import { BEST_CASE_NOTICE } from "./rates";

/**
 * Alex's worked example (uploads/SO-00490-install-price.md) was not in this
 * workspace, and the original quote PDF was not either. The lines below are the
 * anonymised text fixture: same quote number, postcode and goods net, with the
 * customer replaced and the commercial descriptions replaced by stand-ins.
 * The 2-man 2-hour build is an effort-table override, not a hard-coded branch.
 */
const WORKED_EXAMPLE = { cost: 3718.25, customerPrice: 6692.84 };
const MACHINE_DEFAULT: CategoryEffortDefault = {
  category: "strength-selectorised",
  buildCrew: 2,
  buildMinutes: 120,
  note: "Each machine: 2-man, 2-hour build.",
};

const extracted = parseCin7CoreQuote(
  readFileSync(path.join(process.cwd(), "src/lib/quotes/fixtures/cin7-quote-SO-00490.anonymised.txt"), "utf8"),
);

function categoryFor(description: string) {
  return /dumbbell|\bbar\b/i.test(description) ? "weights" : "strength-selectorised";
}

const lines = extracted.lines.map((line) => ({
  sku: line.sku,
  productName: line.description || line.sku,
  category: categoryFor(line.description),
  qty: line.qty,
}));

describe("SO-00490 golden workings", () => {
  const result = priceInstall({
    mode: "A",
    postcode: "IP1 4NJ",
    segment: "big_corporate",
    lines,
    table: loadBundledEffortTable(),
    categoryDefaults: [MACHINE_DEFAULT],
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

  it("classifies machines with the category default and keeps weights as handling", () => {
    assert.equal(result.blockedReason, null);
    assert.equal(result.notice, BEST_CASE_NOTICE);
    assert.equal(result.miles, 60);
    const machines = result.lines.filter((line) => line.match === "category_default");
    const weights = result.lines.filter((line) => line.match === "handling_only");
    assert.equal(machines.length + weights.length, 44);
    assert.ok(machines.every((line) => line.row?.buildCrew === 2 && line.row.buildMinutes === 120));
    assert.ok(weights.every((line) => /bar|dumbbell/i.test(line.productName)));
    assert.equal("breakdown" in forSales(result), false);
    assert.equal("cost" in forSales(result), false);
    assert.equal(forSales(result).notice, BEST_CASE_NOTICE);
    assert.equal(forSales(result).customerPrice, result.customerPrice);
  });

  it("explains the gap to £3,718.25 and £6,692.84 line by line", () => {
    const breakdown = result.breakdown;
    assert.ok(breakdown);
    assert.equal(result.markup, 0.8);
    assert.equal(result.cost, 9149.4);
    assert.equal(result.customerPrice, 16468.92);
    assert.equal(breakdown.labour, 8240.76);
    assert.equal(breakdown.vehicle, 54);
    assert.equal(breakdown.vans, 1);
    assert.equal(breakdown.freight, 0);
    assert.equal(breakdown.consumables, 22.88);
    assert.equal(breakdown.siteContingency, 831.76);
    assert.equal(breakdown.siteCost, 9149.4);
    assert.equal(breakdown.hqCost, 0);
    assert.equal(breakdown.onSiteHours, 183.55);
    assert.equal(breakdown.singleShift.cost, 9149.4);
    assert.equal(breakdown.commute.cost, 10598.53);
    assert.equal(breakdown.stayOvernight.cost, 10886.08);
    assert.equal(Math.round((result.cost! - WORKED_EXAMPLE.cost) * 100) / 100, 5431.15);
    assert.equal(Math.round((result.customerPrice! - WORKED_EXAMPLE.customerPrice) * 100) / 100, 9776.08);
    // 36 machines × 120 min + 45 min prep, 2 vans, no tag cost, 60 miles, 10% contingency.
    // That shape lands on £3,717.32, £0.93 under the worked example, before the 1p markup gap.
    assert.equal(Math.round(3718.25 * 1.8 * 100) / 100, 6692.85);
    assert.notEqual(6692.85, WORKED_EXAMPLE.customerPrice);
    assert.equal(breakdown.handover, "UNSET");
    assert.match(breakdown.driverCheck, /SINGLE-DRIVER DEPENDENCY/);
    assert.equal(breakdown.bigInstall, false);
    assert.ok(breakdown.unset.includes("handover_minutes"));
    assert.ok(breakdown.unset.includes("food_trigger"));
  });
});
