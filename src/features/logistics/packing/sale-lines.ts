import { isGoodsLine } from "@/features/logistics/commercial-invoice/rules";
import type { DemandLine } from "@/lib/packing/types";

type SaleLine = {
  sku?: string | null;
  productName?: string | null;
  qty: number;
  category?: string | null;
  cin7Category?: string | null;
};

/** Goods lines only. Freight and install lines are not packages. Quantities of one SKU are added together. */
export function demandFromSale(lines: SaleLine[]): DemandLine[] {
  const out: DemandLine[] = [];
  for (const line of lines) {
    const sku = line.sku?.trim() ?? "";
    const name = line.productName?.trim() || sku || "Item";
    if (!isGoodsLine({ sku, productName: name, category: line.cin7Category ?? line.category })) continue;
    const existing = sku ? out.find((row) => row.sku === sku) : undefined;
    if (existing) existing.qty += line.qty;
    else out.push({ sku, name, qty: line.qty });
  }
  return out;
}
