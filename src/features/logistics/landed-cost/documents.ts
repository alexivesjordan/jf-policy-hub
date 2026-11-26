import "server-only";

import { customsFromRpc } from "@/features/logistics/commercial-invoice/prepare";
import { isGoodsLine, normaliseHsCode } from "@/features/logistics/commercial-invoice/rules";
import { readPurchase } from "@/features/logistics/landed-cost/read-purchase";
import type { ShipmentLine } from "@/features/logistics/landed-cost/shipment";
import { cin7IsConnected, connectedCin7Get, getCin7Client } from "@/lib/cin7/client";
import type { Cin7Quote } from "@/lib/cin7/types";
import { createClient } from "@/lib/supabase/server";

export type LoadedLine = ShipmentLine & { unitWeightKg: number | null };
export type LoadedDocument = {
  kind: "sale" | "purchase";
  number: string;
  party: string | null;
  currency: string | null;
  destination: string | null;
  lines: LoadedLine[];
};

function goodsFromSale(sale: Cin7Quote): LoadedLine[] {
  return sale.lines.flatMap((line) => {
    if (!isGoodsLine(line)) return [];
    const quantity = line.qty;
    return [{
      sku: line.sku,
      description: line.productName,
      quantity,
      goodsValue: line.lineNet ?? null,
      hsCode: line.hsCode ?? null,
      originCountry: line.originCountry ?? null,
      unitWeightKg: line.unitWeightKg ?? null,
      netWeightKg: line.unitWeightKg != null ? line.unitWeightKg * quantity : null,
    }];
  });
}

export async function loadDutyDocument(kind: "sale" | "purchase", number: string): Promise<LoadedDocument> {
  if (!cin7IsConnected()) throw new Error("Cin7 is not available.");
  if (kind === "sale") {
    const sale = await getCin7Client().getQuote(number);
    if (!sale) throw new Error("Could not find that sale.");
    return {
      kind,
      number: sale.number,
      party: sale.customerName,
      currency: sale.currency ?? null,
      destination: sale.destinationCountry ?? null,
      lines: goodsFromSale(sale),
    };
  }
  const get = connectedCin7Get();
  if (!get) throw new Error("Cin7 is not available.");
  const purchase = await readPurchase(number, (path, query) => get(path, query));
  if (!purchase) throw new Error("Could not find that purchase.");
  return {
    kind,
    number: purchase.number,
    party: purchase.supplier,
    currency: purchase.currency,
    destination: "GB",
    lines: purchase.lines.filter((line) => isGoodsLine({ sku: line.sku, productName: line.description })).map((line) => ({
      sku: line.sku,
      description: line.description,
      quantity: line.quantity,
      goodsValue: line.value,
      hsCode: line.hsCode,
      originCountry: line.originCountry,
      unitWeightKg: line.unitWeightKg,
      netWeightKg: line.unitWeightKg != null ? line.unitWeightKg * line.quantity : null,
    })),
  };
}

export async function withStoredCustoms(lines: LoadedLine[], edits: { hsCode?: string; originCountry?: string }[] | null) {
  if (edits && edits.length !== lines.length) throw new Error("The order changed. Load it again.");
  const skus = lines.map((line) => line.sku).filter((sku): sku is string => Boolean(sku));
  const supabase = await createClient();
  const customs = customsFromRpc((await supabase.rpc("logistics_product_customs", { p_skus: skus })).data);
  return lines.map((line, index) => {
    const saved = customs.find((row) => row.sku === line.sku);
    const edit = edits?.[index];
    const hsCode = normaliseHsCode(edit?.hsCode || "") || line.hsCode || (saved?.hsCode ? normaliseHsCode(saved.hsCode) : null);
    const originCountry = (edit?.originCountry || "").trim().toUpperCase() || line.originCountry || saved?.origin || null;
    return { ...line, hsCode, originCountry: originCountry && /^[A-Z]{2}$/.test(originCountry) ? originCountry : null };
  });
}
