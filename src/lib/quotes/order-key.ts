import { createHash } from "node:crypto";

const SALES_ORDER = /\bSO-\d+\b/i;

export const UNLINKED_ORDER_NOTE =
  "No SO number was on the quote, so it is saved separately and will not block another order.";

function salesOrder(value: string | null | undefined) {
  const match = value?.match(SALES_ORDER);
  return match ? match[0].toUpperCase() : null;
}

function documentNumber(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed.toLowerCase() === "not provided") return null;
  return trimmed;
}

/**
 * The order key stored for install_order_key.
 * An SO number on the PDF wins. A typed SO is next.
 * With no SO and no other number, a hash of this PDF is used so blank quotes do not share one key.
 */
export function orderKeyFromPdf(input: {
  quoteNumber: string | null;
  orderNo: string | null;
  text: string;
  typed: string;
}) {
  const onPdf = salesOrder(input.quoteNumber) ?? salesOrder(input.orderNo) ?? salesOrder(input.text);
  if (onPdf) return { orderNumber: onPdf, source: "so" as const };
  const typed = input.typed.trim();
  const typedSo = salesOrder(typed);
  if (typedSo) return { orderNumber: typedSo, source: "typed" as const };
  const printed = documentNumber(input.quoteNumber) ?? documentNumber(input.orderNo);
  if (printed) return { orderNumber: printed, source: "document" as const };
  if (typed) return { orderNumber: typed, source: "typed" as const };
  const hash = createHash("sha256").update(input.text).digest("hex").slice(0, 12);
  return { orderNumber: `PDF-${hash}`, source: "upload" as const };
}

export function withUnlinkedOrderNote(message: string, orderNumber: string) {
  if (!/^PDF-[0-9a-f]{12}$/.test(orderNumber) || message.includes(UNLINKED_ORDER_NOTE)) return message;
  return `${message} ${UNLINKED_ORDER_NOTE}`;
}
