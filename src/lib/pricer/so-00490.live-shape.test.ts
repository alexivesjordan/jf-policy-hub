import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parseCin7CoreQuote } from "../quotes/parse-cin7-core";
import { effortRowForSku, priceInstall } from "./engine";
import { matchesPinLoadedRule, STRENGTH_HQ_PROFILE } from "./strength-rule";

/**
 * Cin7 categories for the live SO-00490 sale.
 * The nine JF-PS-PIN machines are Other, and JL-DMISC is Functional Fitness:
 * those two were checked on the live sale. The other categories are the Cin7
 * category whose name matches the product (Ski Machines, Treadmills, and so on).
 * JL-DMISC is the 45th line; it is not in the anonymised 44-line fixture.
 */
const CATEGORY: Record<string, string> = {
  "JF-C2SE-2": "Ski Machines",
  "JF-C2SE-FS-2": "Other",
  "JLC-HEXR-P1": "Dumbbells",
  "JTDR-05-10BLK": "Rigs & Racks",
  "JTBR-10-BLK": "Rigs & Racks",
  "JTRBARSN2-1N-RC": "Fixed Barbells",
  "JF-J75-CR-BLK-V3": "Rigs & Racks",
  "JTKBRC3-10": "Kettlebells",
  "JTKBRC3-12": "Kettlebells",
  "JTKBRC3-16": "Kettlebells",
  "JTKBRC3-20": "Kettlebells",
  "JTKBRC3-04": "Kettlebells",
  "JTKBRC3-06": "Kettlebells",
  "JTKBRC3-08": "Kettlebells",
  "JLTR-01": "Rope Trainers",
  "JF-SB-05": "Functional Training Balls",
  "JF-SB-07": "Functional Training Balls",
  "JF-SB-09": "Functional Training Balls",
  "JF-EC-950ET-TFT-21.5": "Treadmills",
  "JF-EC-805R-15.6": "Bikes",
  "JF-EC-805U-15.6": "Bikes",
  "JF-EC-90AB-LCD": "Bikes",
  "JF-C2RE-SL-3": "Rowers",
  "JF-PS-PIN-SP-BLK": "Other",
  "JF-PS-PIN-VP-BLK": "Other",
  "JF-PS-PIN-LP-BLK": "Other",
  "JF-PS-PIN-DCA-BLK": "Other",
  "JF-PS-PIN-LPD-BLK": "Other",
  "JF-PS-PIN-SR-BLK": "Other",
  "JF-PS-PIN-DPF-BLK": "Other",
  "JF-PS-PIN-HAD-BLK": "Other",
  "JF-PS-PIN-SLC-BLK": "Other",
  "JF-EC-805D-15.6": "Elliptical Trainers",
  "JF-CKB-P1": "Kettlebells",
  "JF-KBR-2-BLK": "Rigs & Racks",
  "JF-CRBP-P1": "Bumper Plates",
  "JF-AFID-BLK": "Weight Benches",
  "JLPOWB-01": "Resistance",
  "JLPOWB-02": "Resistance",
  "JLPOWB-03": "Resistance",
  "JLPOWB-04": "Resistance",
  "JLPOWB-05": "Resistance",
  "JLPOWB-06": "Resistance",
  "JF-J75-CPR-BLK-P3": "Rigs & Racks",
  "JL-DMISC": "Functional Fitness",
};

const ASSEMBLY = new Set(["Ski Machines", "Treadmills", "Bikes", "Rowers", "Elliptical Trainers", "Rigs & Racks", "Weight Benches", "Gym Storage"]);
const HANDLING = new Set(["Dumbbells", "Kettlebells", "Fixed Barbells", "Bumper Plates", "Functional Training Balls", "Rope Trainers", "Resistance"]);

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

const extracted = parseCin7CoreQuote(
  readFileSync(path.join(process.cwd(), "src/lib/quotes/fixtures/cin7-quote-SO-00490.anonymised.txt"), "utf8"),
);

const lines = [
  ...extracted.lines.map((line) => ({
    sku: line.sku,
    productName: line.description,
    category: CATEGORY[line.sku],
    qty: line.qty,
    unitWeightKg: FIXTURE_WEIGHT_KG[line.sku] ?? 0,
  })),
  { sku: "JL-DMISC", productName: "Miscellaneous", category: "Functional Fitness", qty: 1, unitWeightKg: 0 },
];

function rowFor(line: (typeof lines)[number]) {
  if (matchesPinLoadedRule(line.productName, line.sku)) {
    return effortRowForSku({
      sku: line.sku,
      productName: line.productName,
      category: line.category,
      needsAssembly: STRENGTH_HQ_PROFILE.needsAssembly,
      crew: STRENGTH_HQ_PROFILE.crew,
      buildMinutes: STRENGTH_HQ_PROFILE.buildMinutes,
      buildLocation: STRENGTH_HQ_PROFILE.buildLocation,
      hqBuildMinutes: STRENGTH_HQ_PROFILE.hqBuildMinutes,
      hqBuildCrew: STRENGTH_HQ_PROFILE.hqBuildCrew,
      sitePositionMinutes: STRENGTH_HQ_PROFILE.sitePositionMinutes,
      needsReview: true,
    });
  }
  if (HANDLING.has(line.category)) {
    return effortRowForSku({
      sku: line.sku,
      productName: line.productName,
      category: line.category,
      needsAssembly: false,
      crew: 1,
      buildMinutes: 0,
      buildLocation: "site",
    });
  }
  if (ASSEMBLY.has(line.category)) {
    return effortRowForSku({
      sku: line.sku,
      productName: line.productName,
      category: line.category,
      needsAssembly: true,
      crew: 2,
      buildMinutes: 120,
      buildLocation: "site",
    });
  }
  return effortRowForSku({
    sku: line.sku,
    productName: line.productName,
    category: line.category,
    needsAssembly: null,
    crew: null,
    buildMinutes: null,
    buildLocation: "site",
  });
}

describe("SO-00490 live-shaped categories", () => {
  const result = priceInstall({
    mode: "A",
    postcode: "IP1 4NJ",
    segment: "big_corporate",
    lines,
    table: lines.map(rowFor),
    categoryDefaults: [],
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

  it("builds the Other pin-loaded machines at HQ", () => {
    assert.equal(lines.length, 45);
    const pins = result.lines.filter((line) => matchesPinLoadedRule(line.productName, ""));
    assert.equal(pins.length, 9);
    assert.ok(pins.every((line) => line.row?.buildLocation === "hq" && line.row.hqBuildMinutes === 120 && line.row.sitePositionMinutes === 45));
    assert.equal(result.breakdown?.hqCost, 592.02);
    assert.ok(result.flags.some((flag) => /Lynnstar per-job quote/.test(flag)));
    assert.equal(result.blockedReason, null);
  });

  it("stays near the golden once those machines are HQ-built", () => {
    // £3,717.52 golden. The £385.93 gap is three extra site builds, which add a night:
    // the FID bench is a 2-hour Weight Benches default rather than 12 minutes,
    // the SkiErg floor stand is Other so it is not handling-only,
    // and JL-DMISC (Functional Fitness, not in the 44-line fixture) is another 2-hour build.
    // HQ labour stays £592.02 and standard freight stays £390.
    assert.equal(result.cost, 4103.45);
    assert.equal(result.customerPrice, 7386.21);
    assert.equal(result.breakdown?.days, 6);
    assert.equal(result.breakdown?.nights, 5);
    assert.equal(result.breakdown?.freight, 390);
    assert.equal(result.breakdown?.hqCost, 592.02);
  });
});
