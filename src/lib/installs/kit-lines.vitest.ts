import { describe, expect, it } from "vitest";
import { isOrderProductLine, orderKitLines } from "@/lib/installs/kit-lines";
import { jobSheetCompleteLine } from "@/lib/installs/visit-form";

describe("order kit lines", () => {
  it("keeps a stock line and drops totals, discounts, carriage, labour, and picking errors", () => {
    const lines = orderKitLines([
      { sku: "", description: "Picking error sales order total", productLine: null, category: null, qty: 1 },
      { sku: "DISC", description: "Discount", productLine: null, category: null, qty: 1 },
      { sku: "CARR-1", description: "Carriage", productLine: null, category: null, qty: 1 },
      { sku: "LAB-1", description: "Installation labour", productLine: null, category: null, qty: 2 },
      { sku: "SO-00526", description: "Sales order total", productLine: null, category: null, qty: 1 },
      { sku: "JF-C2SE-2", description: "Concept2 SkiErg", productLine: null, category: null, qty: 1 },
    ]);
    expect(lines.map((line) => line.sku)).toEqual(["JF-C2SE-2"]);
  });

  it("rejects a line with no real stock SKU", () => {
    expect(isOrderProductLine({ sku: "12", description: "Bolt" })).toBe(false);
    expect(isOrderProductLine({ sku: "", description: "Concept2 SkiErg" })).toBe(false);
  });
});

describe("job sheet completion", () => {
  it("names the order, then the customer, and never leaves a blank", () => {
    expect(jobSheetCompleteLine("SO-00526", "Sample Gym")).toBe("Job sheet for SO-00526 is complete.");
    expect(jobSheetCompleteLine("  ", "Sample Gym")).toBe("Job sheet for Sample Gym is complete.");
    expect(jobSheetCompleteLine("", "")).toBe("Job sheet is complete.");
  });
});
