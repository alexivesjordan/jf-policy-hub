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

/** Fixture weights for this quote only. Not product-master data. */
const FIXTURE_WEIGHT_KG: Record<string, number> = {
  "JF-C2SE-2": 45,
  "JF-C2SE-FS-2": 0,
  "JTDR-05-10BLK": 40,
  "JTBR-10-BLK": 40,
  "JF-J75-CR-BLK-V3": 250,
  "JF-EC-950ET-TFT-21.5": 185,
  "JF-EC-805R-15.6": 80,
  "JF-EC-805U-15.6": 60,
  "JF-EC-90AB-LCD": 60,
  "JF-C2RE-SL-3": 26,
  "JF-EC-805D-15.6": 120,
  "JF-KBR-2-BLK": 30,
  "JF-J75-CPR-BLK-P3": 150,
  "JF-AFID-BLK": 40,
  "JLC-HEXR-P1": 110,
  "JTKBRC3-10": 10,
  "JTKBRC3-12": 12,
  "JTKBRC3-16": 16,
  "JTKBRC3-20": 20,
  "JTKBRC3-04": 4,
  "JTKBRC3-06": 6,
  "JTKBRC3-08": 8,
  "JLTR-01": 12,
  "JF-SB-05": 5,
  "JF-SB-07": 7,
  "JF-SB-09": 9,
  "JF-CKB-P1": 216,
  "JF-CRBP-P1": 150,
  "JTRBARSN2-1N-RC": 275,
  "JLPOWB-01": 5,
};

const lines = extracted.lines.map((line) => ({
  sku: line.sku,
  productName: line.description,
  qty: line.qty,
  unitWeightKg: FIXTURE_WEIGHT_KG[line.sku] ?? 0,
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
    assert.ok(hq.every((line) => line.row?.buildLocation === "hq" && line.row.hqBuildMinutes === 120 && line.row.sitePositionMinutes === 45));
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

  it("matches the reference cost within £1 and recommends the overtime overnight plan", () => {
    const breakdown = result.breakdown;
    assert.ok(breakdown);
    assert.equal(breakdown.roundTripMiles, 127.8);
    assert.equal(breakdown.speedMph, 35);
    assert.equal(breakdown.crew, 2);
    assert.equal(breakdown.vans, 1);
    assert.equal(result.requirements?.vanSize, "crafter");
    assert.equal(breakdown.days, 5);
    assert.equal(breakdown.nights, 4);
    assert.equal(breakdown.freight, 390);
    assert.equal(breakdown.consumables, 6.16);
    assert.equal(breakdown.vehicle, 57.51);
    assert.equal(breakdown.hotel, 640);
    assert.equal(breakdown.food, 150);
    assert.equal(Math.round(breakdown.contingencyRate * 100), 15);
    assert.ok(Math.abs((result.cost ?? 0) - WORKED_COST) <= 1, `cost ${result.cost} on site ${breakdown.onSiteHours}h hq ${breakdown.hqCost}`);
    assert.equal(result.customerPrice, Math.round((result.cost ?? 0) * 1.8 * 100) / 100);
    assert.equal(Math.round(WORKED_COST * 1.8 * 100) / 100, 6692.85);
    assert.equal(Math.round((6692.85 - WORKED_PRICE) * 100) / 100, 0.01);
    const recommended = breakdown.crewPlans.find((plan) => plan.note.includes("Recommended"));
    assert.equal(recommended?.id, "overnight-ot");
    assert.ok(breakdown.crewPlans.every((plan) => plan.id === "overnight-ot" || plan.siteCost + 0.01 >= (recommended?.siteCost ?? 0)));
    assert.ok(result.flags.some((flag) => /Lynnstar per-job quote/.test(flag)));
  });
});
