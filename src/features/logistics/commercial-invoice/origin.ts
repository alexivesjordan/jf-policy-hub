import { countryName, type GoodsLine } from "./rules";

/** Each origin once, highest shipped quantity first, then A to Z. */
export function originSummary(lines: Pick<GoodsLine, "originCountry" | "shippedQuantity">[]) {
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (line.shippedQuantity <= 0) continue;
    const name = countryName(line.originCountry).trim();
    if (!name) continue;
    totals.set(name, (totals.get(name) ?? 0) + line.shippedQuantity);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name)
    .join(", ");
}
