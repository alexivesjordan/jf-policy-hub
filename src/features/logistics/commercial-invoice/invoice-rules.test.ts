import { describe, expect, it } from "vitest";
import { originSummary } from "./origin";
import { acceptedPallets, inspectPallets, palletGrossKg, palletProblems } from "./pallets";
import { matchCustomsStatement, type StatementRule } from "./statements";

const ddp: StatementRule = {
  incoterm: "DDP",
  destinationCountry: "EU",
  carrier: null,
  statementText: "DDP text",
  extraLine: "DDP – VAT Postponed",
  priority: 10,
  active: true,
};
const spainCarrier: StatementRule = {
  incoterm: "DDP",
  destinationCountry: "ES",
  carrier: "FedEx",
  statementText: "Specific",
  extraLine: null,
  priority: 1,
  active: true,
};
const inactive: StatementRule = {
  incoterm: null,
  destinationCountry: "EU",
  carrier: null,
  statementText: "Regime 42",
  extraLine: null,
  priority: 100,
  active: false,
};

describe("commercial invoice origins, pallets and statements", () => {
  it("lists each origin once, by quantity then name", () => {
    expect(originSummary([
      { originCountry: "ES", shippedQuantity: 2 },
      { originCountry: "CN", shippedQuantity: 5 },
      { originCountry: "TW", shippedQuantity: 5 },
      { originCountry: "cn", shippedQuantity: 1 },
      { originCountry: "ES", shippedQuantity: 0 },
    ])).toBe("China, Taiwan, Spain");
  });

  it("accepts complete pallets and sums the gross weight", () => {
    const rows = acceptedPallets([
      { lengthCm: 120, widthCm: 100, depthCm: 150, weightKg: 245 },
      { lengthCm: 0, widthCm: 0, depthCm: 0, weightKg: 0 },
      { lengthCm: 80, widthCm: 60, depthCm: 40, weightKg: 10.5 },
    ]);
    expect(rows.invalid).toBe(false);
    expect(rows.pallets).toHaveLength(2);
    expect(palletGrossKg(rows.pallets)).toBe(255.5);
    expect(palletProblems(rows.pallets, "issue")).toEqual([]);
    expect(palletProblems([], "issue")).toEqual(["Enter at least one pallet."]);
    expect(acceptedPallets([{ lengthCm: 1001, widthCm: 10, depthCm: 10, weightKg: 1 }]).invalid).toBe(true);
    expect(acceptedPallets([{ lengthCm: 10, widthCm: 10, depthCm: 10, weightKg: 1.25 }]).invalid).toBe(true);
    expect(inspectPallets([{ lengthCm: 120, widthCm: 100, depthCm: 150, weightKg: null }], "issue").problems).toEqual(["Pallet 1: enter weight"]);
    expect(inspectPallets([{ lengthCm: 120, widthCm: 100, depthCm: 150, weightKg: null }], "preview").pallets).toEqual([]);
    expect(inspectPallets([{ lengthCm: null, widthCm: null, depthCm: null, weightKg: null }, { lengthCm: 120, widthCm: 80, depthCm: 60, weightKg: 10 }], "preview").pallets).toHaveLength(1);
  });

  it("picks the most specific active customs rule", () => {
    const rules = [ddp, spainCarrier, inactive];
    expect(matchCustomsStatement(rules, { incoterm: "DDP", destinationCountry: "ES", carrier: "FedEx" })).toBe("Specific");
    expect(matchCustomsStatement(rules, { incoterm: "DDP", destinationCountry: "FR", carrier: "" })).toBe("DDP text\nDDP – VAT Postponed");
    expect(matchCustomsStatement(rules, { incoterm: "DAP", destinationCountry: "FR", carrier: "" })).toBe("");
    expect(matchCustomsStatement(rules, { incoterm: "DDP", destinationCountry: "GB", carrier: "FedEx" })).toBe("");
    const france: StatementRule = { ...ddp, destinationCountry: "FR", priority: 1, statementText: "France", extraLine: null };
    const europe: StatementRule = { ...ddp, priority: 5 };
    expect(matchCustomsStatement([europe, france], { incoterm: "DDP", destinationCountry: "FR", carrier: "" })).toBe("France");
  });
});
