import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadBundledEffortTable } from "./effort-table";
import { priceInstall, priceVariation, forSales, BEST_CASE_PROFILE, DEFAULT_PRICING } from "./engine";
import { BEST_CASE_NOTICE, SEGMENT_NOT_SET } from "./rates";

const table = loadBundledEffortTable();

describe("mode A", () => {
  it("prints the best-case notice and prices an exact bench line", () => {
    const result = priceInstall({
      mode: "A",
      postcode: "NR1 1AA",
      miles: 50,
      segment: "independent",
      customerType: "proforma",
      lines: [{ productName: "FID Bench", qty: 1 }],
      table,
    });
    assert.equal(result.notice, BEST_CASE_NOTICE);
    assert.equal(result.blockedReason, null);
    assert.equal(result.crew, 1);
    assert.equal(result.requirements?.installers, 1);
    assert.equal(result.requirements?.vanSize, "small");
    assert.equal(result.requirements?.stairClimber, false);
    assert.equal(result.requirements?.licensedDrivers, result.requirements?.vanCount);
    assert.equal("breakdown" in forSales(result), false);
    assert.ok(result.cost != null && result.cost > 0);
    assert.equal(result.customerPrice, Math.round(result.cost * 1.4 * 100) / 100);
    assert.equal(result.markup, 0.4);
    assert.equal("cost" in forSales(result), false);
    assert.equal(result.minJobChargeConfigured, false);
    assert.ok(result.flags.some((flag) => flag.includes("min job charge not set")));
  });

  it("keeps an exact product row ahead of a category build default", () => {
    const result = priceInstall({
      mode: "A",
      postcode: "NR1 1AA",
      miles: 50,
      segment: "independent",
      lines: [{ productName: "FID Bench", category: "bench", qty: 1 }],
      table,
      categoryDefaults: [{ category: "bench", buildCrew: 2, buildMinutes: 120, note: "Each machine: 2-man, 2-hour build." }],
    });
    assert.equal(result.lines[0]?.match, "exact");
    assert.equal(result.lines[0]?.row?.buildMinutes, 12);
    assert.equal(result.lines[0]?.row?.buildCrew, 1);
  });

  it("refuses an untagged segment", () => {
    const result = priceInstall({
      mode: "A",
      postcode: "NR1 1AA",
      miles: 10,
      segment: null,
      lines: [{ productName: "FID Bench", qty: 1 }],
      table,
    });
    assert.equal(result.blockedReason, SEGMENT_NOT_SET);
    assert.equal(result.customerPrice, null);
  });

  it("uses a category fallback and marks the line provisional", () => {
    const result = priceInstall({
      mode: "A",
      postcode: "NR1 1AA",
      miles: 10,
      segment: "trade",
      lines: [{ productName: "Unlisted bench", category: "bench", qty: 1 }],
      table,
    });
    assert.equal(result.blockedReason, null);
    assert.equal(result.lines[0]?.match, "category_fallback");
    assert.equal(result.finality, "provisional");
    assert.ok(result.provisionalItems.some((item) => item.includes("fallback: bench")));
    assert.equal(result.customerPrice, Math.round((result.cost ?? 0) * 1.5 * 100) / 100);
  });

  it("does not invent a price for an unknown category", () => {
    const result = priceInstall({
      mode: "A",
      postcode: "NR1 1AA",
      miles: 10,
      segment: "franchisee",
      lines: [{ productName: "Mystery widget", category: "widgets", qty: 1 }],
      table,
    });
    assert.match(result.blockedReason ?? "", /No instant price/);
    assert.equal(result.customerPrice, null);
  });

  it("applies the minimum job charge only when it is set", () => {
    const result = priceInstall({
      mode: "A",
      postcode: "NR1 1AA",
      miles: 10,
      segment: "independent",
      lines: [{ productName: "FID Bench", qty: 1 }],
      pricing: { ...DEFAULT_PRICING, minJobCharge: 500, marginFloorPct: 0.1 },
      table,
    });
    assert.equal(result.customerPrice, 500);
    assert.equal(result.minJobChargeConfigured, true);
    assert.equal(result.marginFloorConfigured, true);
    assert.ok((result.marginFloorPrice ?? 0) > 0);
    assert.equal("marginFloorPrice" in forSales(result), false);
  });
});

describe("mode B", () => {
  it("bills extra installer time from the charges grid", () => {
    const result = priceVariation({
      postcode: "NR1 1AA",
      miles: 40,
      segment: "independent",
      lines: [{ productName: "FID Bench", qty: 2 }],
      profile: { ...BEST_CASE_PROFILE, stairs: "2+", parking: "far_or_restricted", access: "long_carry" },
      table,
    });
    assert.equal(result.mode, "B");
    assert.equal(result.manualPricing, false);
    assert.ok((result.variation?.customerCharge ?? 0) > 0);
    assert.equal((result.variation?.billedHours ?? 0) % 0.5, 0);
    assert.equal(result.variation?.rate, 30);
    assert.equal(typeof result.variation?.belowCost, "boolean");
    assert.match(result.variation?.roundingNote ?? "", /proposed/);
  });

  it("does not auto-price a heavy machine on stairs", () => {
    const result = priceVariation({
      postcode: "NR1 1AA",
      miles: 40,
      segment: "big_corporate",
      lines: [{ productName: "DHZ selectorised machine — GENERIC PROVISIONAL", qty: 1 }],
      profile: {
        ...BEST_CASE_PROFILE,
        stairs: "1",
        openingWidthMm: 700,
        openingHeightMm: 1800,
      },
      table,
    });
    assert.equal(result.manualPricing, true);
    assert.equal(result.variation?.customerCharge, null);
    assert.ok(result.manualReasons.some((reason) => /stairs|door-fit/i.test(reason)));
  });
});
