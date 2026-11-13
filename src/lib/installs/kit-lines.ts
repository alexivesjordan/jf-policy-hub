import type { OrderLineView } from "@/lib/installs/visit-form";

const STOCK_SKU = /^[A-Z][A-Z0-9-]{2,}$/i;
const NON_PRODUCT = /\b(picking error|sales order total|order total|sub-?total|grand total|discount|carriage|delivery charge|shipping|labour|labor|call-?out|service charge|installation charge)\b/i;

/**
 * An order line is kit only when it has a stock SKU and is not a charge,
 * total, discount, or picking-error row. Engineer-added lines are separate.
 */
export function isOrderProductLine(line: { sku?: string | null; description?: string | null }) {
  const sku = (line.sku ?? "").trim();
  const description = (line.description ?? "").trim();
  if (!STOCK_SKU.test(sku) || /^SO-\d+$/i.test(sku)) return false;
  if (NON_PRODUCT.test(sku) || NON_PRODUCT.test(description)) return false;
  return true;
}

export function orderKitLines(lines: OrderLineView[]) {
  return lines.filter(isOrderProductLine);
}
