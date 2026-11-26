import { describe, expect, it } from "vitest";
import { calculateLandedCost } from "@/features/logistics/landed-cost/calculate";
import { cached, type CacheStore } from "@/features/logistics/landed-cost/cache";
import { clearMemoryCache } from "@/features/logistics/landed-cost/cache";
import { buildQuote, type QuoteDeps } from "@/features/logistics/landed-cost/quote";
import { matchManualRate } from "@/features/logistics/landed-cost/manual-rates";
import { allocatePence } from "@/features/logistics/landed-cost/money";
import { parseTaricDetails } from "@/features/logistics/landed-cost/taric";
import { dutyLabel, parseCommodity } from "@/features/logistics/landed-cost/uk-tariff";
import { parseHmrcCsv } from "@/features/logistics/landed-cost/exchange";
import { readPurchase } from "@/features/logistics/landed-cost/read-purchase";
import { quoteShipment } from "@/features/logistics/landed-cost/shipment";
import { evaluateDutyPence } from "@/features/logistics/landed-cost/duty";

const percent = (value: number) => ({ pieces: [{ op: "add" as const, kind: "percent" as const, percent: value }] });

describe("UK landed cost", () => {
  it("prices a China gym-equipment import on the CIF basis", () => {
    // 9506919000 from CN, UK Trade Tariff on 26 Nov 2026: third-country duty 2.00%, VAT 20.00%, no preference.
    // HMRC November 2026 USD rate: 1.3396 units per £1.
    // FOB 10,000 + freight 800 + insurance 50 = CIF 10,850 USD.
    const result = calculateLandedCost({
      incoterm: "FOB",
      goodsValue: 10_000,
      freight: 800,
      insurance: 50,
      otherCharges: 0,
      afterBorder: 0,
      unitsPerGbp: 1.3396,
      quantity: 20,
      netWeightKg: null,
      customsDuty: percent(2),
      additional: [],
      vatPercent: 20,
    });
    expect(result.customsValuePence).toBe(809943);
    expect(result.dutyPence).toBe(16199);
    expect(result.vatPence).toBe(165228);
    expect(result.otherChargesPence).toBe(0);
    expect(result.landedPence).toBe(991370);
    expect(result.perUnitPence).toBe(49569);
  });

  it("does not add freight or insurance that a CIF price already includes", () => {
    const cif = calculateLandedCost({
      incoterm: "CIF",
      goodsValue: 10850,
      freight: 800,
      insurance: 50,
      otherCharges: 0,
      afterBorder: 0,
      unitsPerGbp: 1.3396,
      quantity: null,
      netWeightKg: null,
      customsDuty: percent(2),
      additional: [],
      vatPercent: 20,
    });
    expect(cif.customsValuePence).toBe(809943);
    const cfr = calculateLandedCost({
      incoterm: "CFR",
      goodsValue: 10800,
      freight: 800,
      insurance: 50,
      otherCharges: 0,
      afterBorder: 0,
      unitsPerGbp: 1.3396,
      quantity: null,
      netWeightKg: null,
      customsDuty: percent(2),
      additional: [],
      vatPercent: 20,
    });
    expect(cfr.customsValuePence).toBe(809943);
  });

  it("adds other charges to the VAT base and not to the duty base", () => {
    const result = calculateLandedCost({
      incoterm: "FOB",
      goodsValue: 10_000,
      freight: 800,
      insurance: 50,
      otherCharges: 100,
      afterBorder: 0,
      unitsPerGbp: 1.3396,
      quantity: null,
      netWeightKg: null,
      customsDuty: percent(2),
      additional: [],
      vatPercent: 20,
    });
    expect(result.dutyPence).toBe(16199);
    expect(result.otherChargesPence).toBe(7465);
    expect(result.vatPence).toBe(166721);
    expect(result.landedPence).toBe(1_000_328);
  });

  it("removes duty and VAT from a DDP price", () => {
    const result = calculateLandedCost({
      incoterm: "DDP",
      goodsValue: 12240,
      freight: 0,
      insurance: 0,
      otherCharges: 0,
      afterBorder: 0,
      unitsPerGbp: 1,
      quantity: 4,
      netWeightKg: null,
      customsDuty: percent(2),
      additional: [],
      vatPercent: 20,
    });
    expect(result.customsValuePence).toBe(1_000_000);
    expect(result.dutyPence).toBe(20_000);
    expect(result.vatPence).toBe(204_000);
    expect(result.landedPence).toBe(1_224_000);
    expect(result.perUnitPence).toBe(306_000);
  });

  it("stacks anti-dumping on the customs value and the VAT base", () => {
    const result = calculateLandedCost({
      incoterm: "CIF",
      goodsValue: 1000,
      freight: 0,
      insurance: 0,
      otherCharges: 0,
      afterBorder: 0,
      unitsPerGbp: 1,
      quantity: null,
      netWeightKg: null,
      customsDuty: percent(2),
      additional: [{ label: "Anti-dumping", duty: percent(48.5), residual: true }],
      vatPercent: 20,
    });
    expect(result.dutyPence).toBe(2000);
    expect(result.additionalPence).toBe(48500);
    expect(result.vatPence).toBe(30100);
    expect(result.landedPence).toBe(180600);
  });

  it("charges a specific duty from net weight", () => {
    const duty = evaluateDutyPence({
      pieces: [
        { op: "add", kind: "percent", percent: 2 },
        { op: "add", kind: "specific", gbp: 1.2, per: "kg" },
      ],
    }, { customsValuePence: 100000, quantity: null, netWeightKg: 10 });
    expect(duty).toBe(2000 + 1200);
    expect(() => evaluateDutyPence({ pieces: [{ op: "add", kind: "specific", gbp: 1.2, per: "kg" }] }, { customsValuePence: 100000, quantity: null, netWeightKg: null })).toThrow(/net weight/);
  });
});

describe("manual rates and allocation", () => {
  const rates = [
    { destination: "DE", origin: null, hsPrefix: "95", dutyPercent: 4, vatPercent: 19 },
    { destination: "DE", origin: "CN", hsPrefix: "9506", dutyPercent: 2.7, vatPercent: 19 },
    { destination: "DE", origin: "VN", hsPrefix: "9506", dutyPercent: 0, vatPercent: 19 },
  ];

  it("uses the longest prefix and prefers the origin", () => {
    expect(matchManualRate(rates, "DE", "CN", "9506919000")).toMatchObject({ dutyPercent: 2.7 });
    expect(matchManualRate(rates, "DE", "US", "9506919000")).toMatchObject({ dutyPercent: 4, hsPrefix: "95" });
    expect(matchManualRate(rates, "FR", "CN", "9506919000")).toBeNull();
  });

  it("allocates freight so the parts sum to the total", () => {
    expect(allocatePence(100, [1, 1])).toEqual([50, 50]);
    expect(allocatePence(100, [1, 2]).reduce((sum, part) => sum + part, 0)).toBe(100);
  });
});

describe("tariff parsing", () => {
  it("keeps the residual anti-dumping rate and skips a named exporter", () => {
    const parsed = parseCommodity(fixture(), "CN", "2026-11-26");
    expect(parsed.thirdCountry?.percent).toBe(2);
    expect(parsed.vatPercent).toBe(20);
    expect(parsed.preference).toBeNull();
    expect(parsed.additional).toHaveLength(1);
    expect(parsed.additional[0]?.percent).toBe(48.5);
    expect(dutyLabel(parsed.additional[0]!.measureType, parsed.additional[0]!.residual)).toBe("Anti-dumping · residual");
    expect(parsed.description).toContain("physical exercise");
    expect(parseCommodity(fixture(), "VN", "2026-11-26").preference?.percent).toBe(0);
    expect(parseCommodity(fixture(), "KM", "2026-11-26").preference).toBeNull();
  });

  it("reads a TARIC third-country duty and ignores a conditional measure", () => {
    const html = `
      <div>ERGA OMNES (ERGA OMNES 1011)</div>
      <div>Third country duty</div><div>(01-01-1999 - )</div><div>2.70 %</div>
      <div>Low-value consignment customs duty</div><div>3.00 EUR</div><div>[Show conditions]</div>
      <div>Tariff preference</div><div>0.00 %</div>
    `;
    expect(parseTaricDetails(html)).toEqual({
      thirdCountryPercent: 2.7,
      preferencePercent: 0,
      additional: [],
    });
  });

  it("reads an HMRC monthly rate file", () => {
    const rates = parseHmrcCsv("Country,Currency,Currency Code,Currency Units per £1,Start date,End date\nUSA,Dollar,USD,1.3396,01/11/2026,30/11/2026\n");
    expect(rates.get("USD")?.unitsPerGbp).toBe(1.3396);
  });
});

describe("cache", () => {
  it("uses the last saved copy when the live lookup fails", async () => {
    clearMemoryCache();
    const rows = new Map<string, { body: unknown; fetchedAt: string; expiresAt: string }>();
    const store: CacheStore = {
      async get(key) { return rows.get(key) ?? null; },
      async set(key, body, fetchedAt, expiresAt) { rows.set(key, { body, fetchedAt, expiresAt }); },
    };
    const first = await cached("uk:test", 1000, store, async () => ({ duty: 2 }), 1_000);
    expect(first.stale).toBe(false);
    clearMemoryCache();
    const second = await cached("uk:test", 1000, store, async () => { throw new Error("down"); }, 5_000);
    expect(second.stale).toBe(true);
    expect(second.value).toEqual({ duty: 2 });
  });
});

describe("purchase orders", () => {
  it("reads a purchase line, its HS code and its origin", async () => {
    const order = await readPurchase("PO-00123", async (path, query) => {
      if (path === "purchaseList") return { PurchaseList: [{ ID: "11111111-1111-4111-8111-111111111111", OrderNumber: "PO-00123", Supplier: "DHZ", SupplierCurrency: "USD" }], Total: 1 };
      if (path === "purchase") {
        return {
          ID: "11111111-1111-4111-8111-111111111111",
          OrderNumber: "PO-00123",
          Supplier: "DHZ",
          SupplierCurrency: "USD",
          Order: { Lines: [{ SKU: "DHZ-1", Name: "Bench", Quantity: 2, Price: 100, Tax: 0, Total: 200, ProductID: "33333333-3333-4333-8333-333333333333" }], TotalBeforeTax: 200, Total: 200 },
        };
      }
      expect(query.ID).toBe("33333333-3333-4333-8333-333333333333");
      return { Products: [{ SKU: "DHZ-1", HSCode: "95069190", CountryOfOrigin: "China", Weight: 12, WeightUnits: "kg" }] };
    });
    expect(order).toMatchObject({ number: "PO-00123", currency: "USD", supplier: "DHZ" });
    expect(order?.lines[0]).toMatchObject({ sku: "DHZ-1", hsCode: "9506919000", originCountry: "CN", value: 200, quantity: 2, unitWeightKg: 12 });
  });
});

describe("shipment totals", () => {
  it("sums line duty and keeps a line with no commodity out of the total", async () => {
    const deps = fakeDeps();
    const quote = await quoteShipment({
      destination: "GB",
      incoterm: "CIF",
      freight: 0,
      insurance: 0,
      otherCharges: 0,
      afterBorder: 0,
      currency: "GBP",
      rateOverride: null,
      asOf: "2026-11-26",
      claimPreference: true,
    }, [
      { sku: "A", description: "Bench", quantity: 2, goodsValue: 100, hsCode: "9506919000", originCountry: "CN", netWeightKg: null },
      { sku: "B", description: "Cable", quantity: 1, goodsValue: 50, hsCode: null, originCountry: "CN", netWeightKg: null },
    ], deps);
    expect(quote.lines[1]?.error).toBe("No commodity code.");
    expect(quote.lines[0]?.result?.additional[0]?.pence).toBe(4850);
    expect(quote.totals?.customsValuePence).toBe(10000);
    expect(quote.totals?.dutyPence).toBe(200);
    expect(quote.totals?.vatPence).toBe(3010);
    expect(quote.totals?.landedPence).toBe(18060);
  });
});

function fakeDeps(): QuoteDeps {
  return {
    async ukCommodity() {
      return { payload: fixture(), stale: false };
    },
    async hmrcMonth() {
      return { csv: "Country,Currency,Currency Code,Currency Units per £1,Start date,End date\n", stale: false };
    },
    async taricHtml() {
      return null;
    },
    async manualRates() {
      return [];
    },
  };
}

function fixture() {
  const measures = [
    piece("m-third", "103", "1011", 2),
    piece("m-pref", "142", "VN", 0),
    piece("m-pref-excluded", "142", "1013", 0, { excluded: ["KM"] }),
    piece("m-vat", "305", "1400", 20),
    piece("m-company", "552", "CN", 30, { additional: "co-1", code: "B123", description: "Example Co" }),
    piece("m-residual", "552", "CN", 48.5, { additional: "co-2", code: "B999", description: "All other overseas exporters (residual amount)" }),
  ];
  return {
    data: {
      id: "9506919000",
      type: "commodity",
      attributes: { description: "Other", declarable: true, goods_nomenclature_item_id: "9506919000" },
      relationships: {
        import_measures: { data: measures.map((item) => ({ id: item.measure.id, type: "measure" })) },
        ancestors: { data: [{ id: "h", type: "heading" }] },
      },
    },
    included: [
      { id: "h", type: "heading", attributes: { description: "Articles and equipment for general physical exercise" } },
      { id: "1011", type: "geographical_area", attributes: { description: "ERGA OMNES" }, relationships: { children_geographical_areas: { data: [{ id: "CN", type: "geographical_area" }, { id: "VN", type: "geographical_area" }, { id: "KM", type: "geographical_area" }] } } },
      { id: "1013", type: "geographical_area", attributes: { description: "European Union" }, relationships: { children_geographical_areas: { data: [{ id: "DE", type: "geographical_area" }, { id: "KM", type: "geographical_area" }] } } },
      { id: "1400", type: "geographical_area", attributes: { description: "VAT" }, relationships: { children_geographical_areas: { data: [{ id: "CN", type: "geographical_area" }, { id: "VN", type: "geographical_area" }] } } },
      { id: "CN", type: "geographical_area", attributes: { description: "China" }, relationships: {} },
      { id: "VN", type: "geographical_area", attributes: { description: "Vietnam" }, relationships: {} },
      { id: "KM", type: "geographical_area", attributes: { description: "Comoros" }, relationships: {} },
      { id: "co-1", type: "additional_code", attributes: { code: "B123", description: "Example Co" } },
      { id: "co-2", type: "additional_code", attributes: { code: "B999", description: "All other overseas exporters (residual amount)" } },
      ...measures.flatMap((item) => [item.measure, item.component]),
    ],
  };
}

function piece(id: string, type: string, area: string, amount: number, extra?: { excluded?: string[]; additional?: string; code?: string; description?: string }) {
  return {
    measure: {
      id,
      type: "measure",
      attributes: { import: true, effective_start_date: "2021-01-01T00:00:00.000Z", effective_end_date: null },
      relationships: {
        measure_type: { data: { id: type, type: "measure_type" } },
        geographical_area: { data: { id: area, type: "geographical_area" } },
        measure_components: { data: [{ id: `${id}-c`, type: "measure_component" }] },
        order_number: { data: null },
        excluded_countries: { data: (extra?.excluded ?? []).map((code) => ({ id: code, type: "geographical_area" })) },
        additional_code: extra?.additional ? { data: { id: extra.additional, type: "additional_code" } } : { data: null },
      },
    },
    component: {
      id: `${id}-c`,
      type: "measure_component",
      attributes: { duty_amount: amount, duty_expression_id: "01", monetary_unit_code: null, measurement_unit_code: null },
    },
  };
}

describe("preference claim", () => {
  it("uses the third-country rate when preference is not claimed", async () => {
    const request = {
      destination: "GB",
      origin: "VN",
      commodityCode: "950691",
      incoterm: "CIF" as const,
      goodsValue: 100,
      freight: 0,
      insurance: 0,
      otherCharges: 0,
      afterBorder: 0,
      currency: "GBP",
      rateOverride: null,
      asOf: "2026-11-26",
      quantity: null,
      netWeightKg: null,
      claimPreference: false,
    };
    const third = await buildQuote(request, fakeDeps());
    expect(third.dutyPercent).toBe(2);
    expect(third.rulesOfOrigin).toBe(false);
    expect(third.preferenceAvailable).toBe(true);
    expect(third.estimate).toBe(false);
    const claimed = await buildQuote({ ...request, claimPreference: true }, fakeDeps());
    expect(claimed.dutyPercent).toBe(0);
    expect(claimed.dutyLabel).toBe("Preferential · rules of origin");
    expect(claimed.landedPence).toBe(12000);
  });
});
