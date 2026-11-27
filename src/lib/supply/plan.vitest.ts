import { describe, expect, it } from "vitest";
import {
  classifyDemand,
  crostonSba,
  mergeDemand,
  planSku,
  roundOrderQty,
  seasonalIndices,
  zForServiceLevel,
} from "@/lib/supply/plan";

const smooth = {
  monthly: [10, 10, 10, 10, 10, 10],
  startMonth: 0,
  leadTimeDays: 30,
  reviewDays: 30,
  safetyDays: 15,
  serviceLevel: 0.95,
  moq: 12,
  orderMultiple: 5,
  available: 4,
  onOrder: 6,
  onHand: 4,
  smaWindow: 6,
  crostonAlpha: 0.2,
  forecastMonths: 6,
};

describe("reorder maths", () => {
  it("uses the standard normal 95% point", () => {
    expect(zForServiceLevel(0.95)).toBeCloseTo(1.64485362695, 4);
  });

  it("classifies smooth, erratic, intermittent, and lumpy demand", () => {
    expect(classifyDemand([10, 12, 11, 13, 9, 15]).klass).toBe("smooth");
    // Mean 5.75, sample variance 90.25, CV² about 2.73, ADI 1.
    expect(classifyDemand([1, 1, 1, 20]).klass).toBe("erratic");
    // ADI 12/3 = 4, CV² of 5, 8, 6 is about 0.058.
    expect(classifyDemand([0, 0, 5, 0, 0, 0, 8, 0, 0, 6, 0, 0]).klass).toBe("intermittent");
    // ADI 6, CV² of 1 and 20 is about 1.64.
    expect(classifyDemand([0, 0, 1, 0, 0, 0, 20, 0, 0, 0, 0, 0]).klass).toBe("lumpy");
  });

  it("forecasts a flat series and nets stock already on order", () => {
    // SMA 10. Lead-time demand 10. Safety 10 * 15/30 = 5. Reorder point 15.
    // Order-up-to 10 * 60/30 + 5 = 25. Net 4 + 6 = 10. Suggested 15, already on a multiple of 5 and above MOQ 12.
    const plan = planSku(smooth);
    expect(plan.classification).toBe("smooth");
    expect(plan.method).toBe("sma");
    expect(plan.level).toBeCloseTo(10, 6);
    expect(plan.leadTimeDemand).toBeCloseTo(10, 6);
    expect(plan.safetyStock).toBeCloseTo(5, 6);
    expect(plan.reorderPoint).toBeCloseTo(15, 6);
    expect(plan.orderUpTo).toBeCloseTo(25, 6);
    expect(plan.suggestedQty).toBe(15);
    expect(plan.belowReorder).toBe(true);
    expect(plan.zeroStock).toBe(false);
    expect(plan.reason).toContain("Below reorder point");
  });

  it("rounds up to the order multiple after the MOQ", () => {
    const plan = planSku({ ...smooth, available: 0, onOrder: 0, onHand: 0, moq: 10, orderMultiple: 6 });
    // Raw need 25. Whole units 25. ceil(25/6)*6 = 30.
    expect(plan.suggestedQty).toBe(30);
    expect(plan.zeroStock).toBe(true);
    expect(plan.reason).toContain("Rounded to order multiple");
    expect(roundOrderQty(3, 10, 4)).toBe(12);
    expect(roundOrderQty(0, 10, 4)).toBe(0);
  });

  it("does not order when stock covers the reorder point", () => {
    const plan = planSku({ ...smooth, available: 30, onOrder: 0, onHand: 30 });
    expect(plan.suggestedQty).toBe(0);
    expect(plan.belowReorder).toBe(false);
    expect(plan.reason).toBe("Covered");
    const heavy = planSku({ ...smooth, available: 80, onOrder: 0, onHand: 80 });
    expect(heavy.overstock).toBe(true);
    expect(heavy.suggestedQty).toBe(0);
  });

  it("uses SBA for an intermittent series", () => {
    const series = [0, 0, 5, 0, 0, 0, 8, 0, 0, 6, 0, 0];
    // z ends at 5.68 and p at 3.16. (1 - 0.2/2) * 5.68/3.16 = 1.6177215.
    expect(crostonSba(series, 0.2)).toBeCloseTo(1.617721518987, 6);
    const plan = planSku({
      ...smooth,
      monthly: series,
      safetyDays: 30,
      reviewDays: 0,
      moq: 0,
      orderMultiple: 1,
      available: 0,
      onOrder: 0,
      onHand: 0,
    });
    expect(plan.classification).toBe("intermittent");
    expect(plan.method).toBe("sba");
    expect(plan.level).toBeCloseTo(1.617721518987, 6);
    // Lead 30 days and safety 30 days, so reorder point is twice the level. ceil(3.2354) = 4.
    expect(plan.reorderPoint).toBeCloseTo(3.23544303797, 5);
    expect(plan.suggestedQty).toBe(4);
  });

  it("builds seasonal indices only from 24 months and applies them to a smooth series", () => {
    const pattern = [8, 9, 10, 11, 12, 13, 12, 11, 10, 9, 8, 7];
    const series = [...pattern, ...pattern];
    expect(seasonalIndices(series.slice(0, 23))).toBeNull();
    const indices = seasonalIndices(series);
    expect(indices).not.toBeNull();
    const expected = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.2, 1.1, 1, 0.9, 0.8, 0.7];
    indices?.forEach((value, index) => expect(value).toBeCloseTo(expected[index] ?? 0, 6));
    const plan = planSku({
      ...smooth,
      monthly: series,
      startMonth: 0,
      forecastMonths: 1,
      safetyDays: 0,
      reviewDays: 0,
      leadTimeDays: 30,
      moq: 0,
      orderMultiple: 1,
    });
    // Deseasonalised level is 10. Next month is January, index 0.8, forecast 8.
    expect(plan.method).toBe("seasonal_sma");
    expect(plan.forecasts[0]).toBeCloseTo(8, 6);
    expect(plan.classification).toBe("smooth");
  });

  it("prefers Cin7 when Orderwise has the same month", () => {
    const merged = mergeDemand([
      { month: "2024-01-01", qty: 4, source: "orderwise" },
      { month: "2024-01-01", qty: 9, source: "cin7" },
      { month: "2024-03-01", qty: 2, source: "orderwise" },
    ]);
    expect(merged.months).toEqual(["2024-01-01", "2024-02-01", "2024-03-01"]);
    expect(merged.qty).toEqual([9, 0, 2]);
  });
});
