import { describe, expect, it } from "vitest";
import { effortRowForSku, forSales, priceInstall, type QuoteLineInput } from "./engine";
import type { EffortRow } from "./effort-table";

/**
 * SO-00864 is not in this repo and Cin7 is not connected here, so this fixture
 * uses the classification rules rather than a copied sale. Loose kit is
 * delivery-only. The four rack families Alex timed are 1 x 10. Any other rack
 * or unsure row has no build time and is marked Needs review.
 */
const LINES: QuoteLineInput[] = [
  { sku: "JLC-HEX-10", productName: "Hex dumbbell 10kg", category: "Dumbbells", qty: 20, unitWeightKg: 10 },
  { sku: "JLC-HEX-20", productName: "Hex dumbbell 20kg", category: "Dumbbells", qty: 10, unitWeightKg: 20 },
  { sku: "JF-DBR-2", productName: "2 tier horizontal dumbbell rack", category: "Rigs & Racks", qty: 1, unitWeightKg: 28 },
  { sku: "JL-VDR", productName: "Vertical dumbbell rack", category: "Rigs & Racks", qty: 1, unitWeightKg: 32 },
  { sku: "JF-OBH", productName: "Olympic bar holder", category: "Gym Storage", qty: 1, unitWeightKg: 18 },
  { sku: "JF-SMH", productName: "Freestanding gym storage system - mat hanger", category: "Gym Storage", qty: 1, unitWeightKg: 14 },
  { sku: "JF-KBR-3", productName: "3 tier kettlebell rack", category: "Rigs & Racks", qty: 1, unitWeightKg: 36 },
];

function rowFor(line: QuoteLineInput): EffortRow {
  const name = line.productName;
  if (/dumbbell rack|vertical dumbbell rack|olympic bar holder|mat hanger/i.test(name)) {
    return effortRowForSku({
      sku: line.sku ?? name,
      productName: name,
      category: line.category ?? null,
      needsAssembly: true,
      crew: 1,
      buildMinutes: 10,
      effortClass: "rack",
      rackFamily: name,
    });
  }
  if (/kettlebell rack/i.test(name)) {
    return effortRowForSku({
      sku: line.sku ?? name,
      productName: name,
      category: line.category ?? null,
      needsAssembly: null,
      crew: null,
      buildMinutes: null,
      effortClass: "rack",
      rackFamily: "Kettlebell rack (2-tier / 3-tier / S-Series)",
    });
  }
  return effortRowForSku({
    sku: line.sku ?? name,
    productName: name,
    category: line.category ?? null,
    needsAssembly: false,
    crew: 1,
    buildMinutes: 0,
    effortClass: "delivery_only",
  });
}

describe("SO-00864 classification", () => {
  const result = priceInstall({
    mode: "A",
    postcode: "PE30 4JJ",
    miles: 0,
    segment: "trade",
    lines: LINES,
    table: LINES.map(rowFor),
    categoryDefaults: [],
  });

  it("excludes untimed racks, loose-kit freight and loose-kit tags", () => {
    const review = result.lines.find((line) => line.productName.includes("kettlebell rack"));
    expect(review?.note).toBe("No build time set");
    expect(review?.row?.buildMinutes).toBe(0);
    expect(forSales(result).hasUnpricedBuildLines).toBe(true);
    expect(forSales(result).pricerVersion).toBe("v2.6");
    expect(result.lines.filter((line) => /dumbbell \d/.test(line.productName)).every((line) => line.match === "handling_only")).toBe(true);
    expect(result.breakdown?.freight).toBe(0);
    expect(result.breakdown?.consumables).toBe(0.88);
    expect(result.breakdown?.hotel).toBe(0);
    expect(result.breakdown?.days).toBe(1);
    expect(result.flags.some((flag) => /weight unknown/i.test(flag))).toBe(false);
    expect(result.flags.some((flag) => flag.startsWith("No build time set: 3 tier kettlebell rack"))).toBe(true);
    expect(result.flags.some((flag) => flag.includes("dumbbell"))).toBe(false);
    expect(result.customerPrice).toBe(85.19);
  });
});
