import { describe, expect, it } from "vitest";
import { originSummary } from "./origin";
import { acceptedPallets, inspectPallets, palletGrossKg, palletProblems } from "./pallets";
import { DDP_FISCAL_STATEMENTS } from "./ddp-statements";
import { matchCustomsStatement, prepareCustomsStatement, type StatementRule } from "./statements";
import { readFileSync } from "node:fs";

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

  it("matches only a DDP rule, and only when the shipment is DDP", () => {
    const seeded: StatementRule[] = DDP_FISCAL_STATEMENTS.map((rule) => ({
      incoterm: "DDP",
      destinationCountry: rule.destinationCountry,
      carrier: null,
      statementText: rule.text,
      extraLine: null,
      priority: rule.priority,
      active: true,
    }));
    const open: StatementRule = { incoterm: null, destinationCountry: "EU", carrier: null, statementText: "Any incoterm", extraLine: null, priority: 100, active: true };
    const exw: StatementRule = { incoterm: "EXW", destinationCountry: "BE", carrier: null, statementText: "Ex works", extraLine: null, priority: 100, active: true };
    const rules = [...seeded, open, exw];
    const be = DDP_FISCAL_STATEMENTS.find((rule) => rule.destinationCountry === "BE")!.text;
    const eu = DDP_FISCAL_STATEMENTS.find((rule) => rule.destinationCountry === "EU")!.text;
    const nl = DDP_FISCAL_STATEMENTS.find((rule) => rule.destinationCountry === "NL")!.text;
    for (const country of ["BE", "LU", "NL", "IE", "FR"]) {
      const expected = DDP_FISCAL_STATEMENTS.find((rule) => rule.destinationCountry === country)!.text;
      expect(matchCustomsStatement(rules, { incoterm: "DDP", destinationCountry: country, carrier: "" })).toBe(expected);
      expect(matchCustomsStatement(rules, { incoterm: "EXW", destinationCountry: country, carrier: "" })).toBe("");
      expect(matchCustomsStatement(rules, { incoterm: "DAP", destinationCountry: country, carrier: "" })).toBe("");
    }
    expect(matchCustomsStatement(rules, { incoterm: "DDP", destinationCountry: "DE", carrier: "" })).toBe(eu);
    expect(matchCustomsStatement(rules, { incoterm: "DDP", destinationCountry: "CH", carrier: "" })).toBe("");
    expect(matchCustomsStatement(rules, { incoterm: "DDP", destinationCountry: "BE", carrier: "" })).toBe(be);
    expect(matchCustomsStatement([open, exw], { incoterm: "DDP", destinationCountry: "BE", carrier: "" })).toBe("");
    const prepared = prepareCustomsStatement({ incoterm: "DDP", statementId: "matched", text: nl, buyerVat: "NL123456789B01" });
    expect(prepared.error).toBe("");
    expect(prepared.text).toContain("NL123456789B01");
    expect(prepared.text).not.toContain("{buyerVat}");
    expect(prepareCustomsStatement({ incoterm: "DDP", statementId: "matched", text: nl, buyerVat: "  " }).error).toBe("Buyer VAT is required for this customs statement.");
    expect(prepareCustomsStatement({ incoterm: "DAP", statementId: "matched", text: be, buyerVat: "" })).toEqual({ id: "none", text: "", error: "" });
    const migration = readFileSync("supabase/migrations/20261123160000_logistics_ddp_fiscal_statements.sql", "utf8");
    const rollback = readFileSync("supabase/release/r3/ddp-fiscal-statements-rollback.sql", "utf8");
    for (const rule of DDP_FISCAL_STATEMENTS) {
      expect(rule.text.length).toBeGreaterThan(0);
      expect(rule.text.length).toBeLessThanOrEqual(2000);
      expect(migration).toContain(rule.id);
      expect(migration).toContain(rule.text);
      expect(rollback).toContain(rule.id);
    }
    expect(migration).toContain("FRZS 8888 63388");
    expect(migration).not.toMatch(/update logistics\.customs_statement_rules/i);
  });
});
