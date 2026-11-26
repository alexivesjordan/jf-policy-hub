import { isGoodsLine } from "@/features/logistics/commercial-invoice/rules";
import { allocatePence } from "@/features/logistics/landed-cost/money";
import { buildQuote, type QuoteDeps, type QuoteRequest, type QuoteView } from "@/features/logistics/landed-cost/quote";

export type ShipmentLine = {
  sku: string | null;
  description: string;
  quantity: number;
  goodsValue: number | null;
  hsCode: string | null;
  originCountry: string | null;
  netWeightKg: number | null;
};

export type ShipmentHeader = Omit<QuoteRequest, "origin" | "commodityCode" | "goodsValue" | "quantity" | "netWeightKg"> & {
  destination: string;
};

export type ShipmentLineResult = {
  sku: string | null;
  description: string;
  hsCode: string | null;
  origin: string | null;
  quantity: number;
  goodsValue: number | null;
  error: string | null;
  result: QuoteView | null;
};

export type ShipmentQuote = {
  lines: ShipmentLineResult[];
  totals: {
    customsValuePence: number;
    dutyPence: number;
    additionalPence: number;
    vatPence: number;
    otherChargesPence: number;
    landedPence: number;
  } | null;
  estimate: boolean;
  stale: boolean;
};

export async function quoteShipment(header: ShipmentHeader, lines: ShipmentLine[], deps: QuoteDeps): Promise<ShipmentQuote> {
  const goods = lines.filter((line) => isGoodsLine({ sku: line.sku, productName: line.description }));
  if (!goods.length) throw new Error("No goods lines.");
  const weights = goods.map((line) => (line.goodsValue != null && line.goodsValue > 0 ? line.goodsValue : 0));
  const freight = allocatePence(Math.round(header.freight * 100), weights).map((pence) => pence / 100);
  const insurance = allocatePence(Math.round(header.insurance * 100), weights).map((pence) => pence / 100);
  const other = allocatePence(Math.round(header.otherCharges * 100), weights).map((pence) => pence / 100);
  const after = allocatePence(Math.round(header.afterBorder * 100), weights).map((pence) => pence / 100);

  const results: ShipmentLineResult[] = [];
  for (let index = 0; index < goods.length; index += 1) {
    const line = goods[index]!;
    const base = {
      sku: line.sku,
      description: line.description,
      hsCode: line.hsCode,
      origin: line.originCountry,
      quantity: line.quantity,
      goodsValue: line.goodsValue,
    };
    if (line.goodsValue == null) {
      results.push({ ...base, error: "No line value.", result: null });
      continue;
    }
    if (!line.hsCode) {
      results.push({ ...base, error: "No commodity code.", result: null });
      continue;
    }
    if (!line.originCountry) {
      results.push({ ...base, error: "No origin.", result: null });
      continue;
    }
    try {
      const result = await buildQuote({
        ...header,
        origin: line.originCountry,
        commodityCode: line.hsCode,
        goodsValue: line.goodsValue,
        freight: freight[index] ?? 0,
        insurance: insurance[index] ?? 0,
        otherCharges: other[index] ?? 0,
        afterBorder: after[index] ?? 0,
        quantity: line.quantity > 0 ? line.quantity : null,
        netWeightKg: line.netWeightKg,
      }, deps);
      results.push({ ...base, hsCode: result.commodityCode, origin: result.origin, error: null, result });
    } catch (error) {
      results.push({ ...base, error: error instanceof Error ? error.message : "This line could not be calculated.", result: null });
    }
  }

  const priced = results.flatMap((line) => (line.result ? [line.result] : []));
  if (!priced.length) {
    return { lines: results, totals: null, estimate: true, stale: false };
  }
  const sum = (pick: (line: QuoteView) => number) => priced.reduce((total, line) => total + pick(line), 0);
  return {
    lines: results,
    totals: {
      customsValuePence: sum((line) => line.customsValuePence),
      dutyPence: sum((line) => line.dutyPence),
      additionalPence: sum((line) => line.additional.reduce((total, charge) => total + charge.pence, 0)),
      vatPence: sum((line) => line.vatPence),
      otherChargesPence: sum((line) => line.otherChargesPence),
      landedPence: sum((line) => line.landedPence),
    },
    estimate: priced.some((line) => line.estimate),
    stale: priced.some((line) => line.stale),
  };
}
