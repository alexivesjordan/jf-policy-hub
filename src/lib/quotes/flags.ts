/** Quote flags are selected by code. Do not filter them by matching the message text. */
export const QUOTE_FLAG_CODES = [
  "manual_review",
  "manual_override",
  "no_pm_scope",
  "no_warranty_scope",
  "goods_net_discrepancy",
  "goods_net_missing",
  "multi_site_approval",
  "cin7_totals_mismatch",
  "cin7_tax_included",
  "cin7_order_total_missing",
  "cin7_line_total_missing",
] as const;

export type QuoteFlagCode = (typeof QUOTE_FLAG_CODES)[number];

export type QuoteFlag = {
  code: QuoteFlagCode;
  /** Signed pounds. Null when the flag is not a money gap. */
  difference: number | null;
  message: string;
};

export function quoteFlag(code: QuoteFlagCode, message: string, difference: number | null = null): QuoteFlag {
  return { code, difference, message };
}
