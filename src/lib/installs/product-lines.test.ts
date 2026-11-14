import { describe, expect, it } from "vitest";
import { documentsForOrder, maintenanceDocForLine, maintenanceDocsForLines, selectStoredDocuments } from "@/lib/installs/product-lines";

describe("maintenance docs by product line", () => {
  it("maps named ranges and leaves unknown equipment off the pack", () => {
    expect(maintenanceDocForLine({ productName: "Jordan Elite lat pulldown" })).toBe("elite_strength");
    expect(maintenanceDocForLine({ productName: "Jordan Elite treadmill" })).toBe("cardio");
    expect(maintenanceDocForLine({ productName: "Performance Strength pin loaded chest press" })).toBe("performance_strength");
    expect(maintenanceDocForLine({ productName: "DHZ leg press", category: "strength-selectorised" })).toBe("performance_strength");
    expect(maintenanceDocForLine({ productName: "Concept2 SkiErg" })).toBe("cardio");
    expect(maintenanceDocForLine({ description: "Delivery charge" })).toBeNull();
    expect(maintenanceDocForLine({ productName: "FID Bench", category: "bench" })).toBeNull();
    expect(maintenanceDocForLine({ productLine: "Elite", description: "Treadmill" })).toBe("cardio");
    expect(maintenanceDocForLine({ productLine: "Cardio", productName: "Upright bike" })).toBe("cardio");
    expect(maintenanceDocForLine({ category: "cardio", productName: "Machine" })).toBe("cardio");
  });

  it("attaches the catalogue and only the ranges on the order", () => {
    const lines = [
      { productName: "Jordan Elite lat pulldown" },
      { productName: "Concept2 SkiErg" },
      { description: "Installation and packaging removal" },
    ];
    expect(maintenanceDocsForLines(lines)).toEqual(["elite_strength", "cardio"]);
    expect(documentsForOrder(lines)).toEqual(["catalogue", "elite_strength", "cardio"]);
    expect(documentsForOrder([{ description: "Delivery charge" }])).toEqual(["catalogue"]);
  });

  it("skips guides that have not been uploaded", () => {
    const wanted = documentsForOrder([
      { productName: "Performance Strength chest press" },
      { productName: "Jordan treadmill", category: "cardio" },
    ]);
    expect(selectStoredDocuments(wanted, ["catalogue"])).toEqual({
      attach: ["catalogue"],
      skipped: ["performance_strength", "cardio"],
    });
    expect(selectStoredDocuments(wanted, [])).toEqual({
      attach: [],
      skipped: ["catalogue", "performance_strength", "cardio"],
    });
  });
});
