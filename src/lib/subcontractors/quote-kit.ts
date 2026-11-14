import { isOrderProductLine } from "@/lib/installs/kit-lines";

export type KitLine = { sku?: string | null; qty: number; description: string; unitWeightKg?: number | null };

export function formatKitQty(qty: number) {
  if (!Number.isFinite(qty) || qty <= 0) return "1";
  const rounded = Math.round(qty * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function formatOrderWeight(kg: number | null) {
  if (kg == null || !Number.isFinite(kg) || kg <= 0) return "[WEIGHT]";
  const rounded = Math.round(kg * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Sum printed or Cin7 weights. Any missing product weight makes the total unknown. */
export function orderWeightKg(lines: KitLine[], documentWeightKg?: number | null) {
  if (documentWeightKg != null && documentWeightKg > 0) return documentWeightKg;
  const products = lines.filter((line) => isOrderProductLine(line));
  if (products.length === 0) return null;
  if (products.some((line) => line.unitWeightKg == null || line.unitWeightKg <= 0)) return null;
  const sum = products.reduce((total, line) => total + (line.unitWeightKg ?? 0) * line.qty, 0);
  return Math.round(sum * 10) / 10;
}

export function subcontractorKitLines(lines: KitLine[]) {
  return lines
    .filter((line) => isOrderProductLine(line) && line.description.trim())
    .map((line) => ({ qty: line.qty > 0 ? line.qty : 1, description: line.description.trim() }));
}
