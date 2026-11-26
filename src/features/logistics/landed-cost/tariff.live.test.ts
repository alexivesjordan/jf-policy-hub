import { describe, expect, it } from "vitest";
import { fetchOfficial } from "@/features/logistics/landed-cost/http";
import { commodityUrl, hmrcRatesUrl, parseHmrcCsv } from "@/features/logistics/landed-cost/exchange";
import { calculateLandedCost } from "@/features/logistics/landed-cost/calculate";
import { parseTaricDetails, taricDetailsUrl, taricMeasuresUrl } from "@/features/logistics/landed-cost/taric";
import { dutyLabel, parseCommodity } from "@/features/logistics/landed-cost/uk-tariff";

const asOf = "2026-11-26";

describe("live tariff lookups", () => {
  it("matches the UK Trade Tariff for gym equipment from China, Vietnam and Russia", async () => {
    const payload = JSON.parse(await fetchOfficial(commodityUrl("9506919000", asOf))) as unknown;
    const china = parseCommodity(payload, "CN", asOf);
    expect(china.thirdCountry?.percent).toBe(2);
    expect(china.vatPercent).toBe(20);
    expect(china.preference).toBeNull();
    expect(china.additional).toHaveLength(0);
    const vietnam = parseCommodity(payload, "VN", asOf);
    expect(vietnam.preference?.percent).toBe(0);
    expect(vietnam.thirdCountry?.percent).toBe(2);
    const russia = parseCommodity(payload, "RU", asOf);
    expect(russia.additional.some((measure) => measure.percent === 35 && measure.measureType === "695")).toBe(true);

    const rates = parseHmrcCsv(await fetchOfficial(hmrcRatesUrl("2026-11")));
    expect(rates.get("USD")?.unitsPerGbp).toBe(1.3396);
    const result = calculateLandedCost({
      incoterm: "FOB",
      goodsValue: 10_000,
      freight: 800,
      insurance: 50,
      otherCharges: 0,
      afterBorder: 0,
      unitsPerGbp: rates.get("USD")!.unitsPerGbp,
      quantity: 20,
      netWeightKg: null,
      customsDuty: china.thirdCountry!.duty,
      additional: china.additional.map((measure) => ({ label: dutyLabel(measure.measureType, measure.residual), duty: measure.duty, residual: measure.residual })),
      vatPercent: china.vatPercent!,
    });
    expect(result.customsValuePence).toBe(809943);
    expect(result.dutyPence).toBe(16199);
    expect(result.vatPence).toBe(165228);
    expect(result.landedPence).toBe(991370);
    expect(result.perUnitPence).toBe(49569);
  }, 30_000);

  it("uses the residual anti-dumping duty on bicycles from China once", async () => {
    const payload = JSON.parse(await fetchOfficial(commodityUrl("8712003090", asOf))) as unknown;
    const china = parseCommodity(payload, "CN", asOf);
    expect(china.thirdCountry?.percent).toBe(14);
    const dumping = china.additional.filter((measure) => measure.measureType === "552");
    expect(dumping).toHaveLength(1);
    expect(dumping[0]?.percent).toBe(48.5);
    expect(dumping[0]?.residual).toBe(true);
  }, 30_000);

  it("reads the EU TARIC third-country duty for the same gym equipment", async () => {
    const measures = await fetchOfficial(taricMeasuresUrl("9506919000", "CN", asOf));
    const details = taricDetailsUrl(measures);
    expect(details).toBeTruthy();
    const parsed = parseTaricDetails(await fetchOfficial(details!));
    expect(parsed.thirdCountryPercent).toBe(2.7);
  }, 30_000);
});
