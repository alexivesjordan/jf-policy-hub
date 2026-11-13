export type ExtractedLine = {
  lineNo: number;
  sku: string;
  description: string;
  qty: number;
  rsp: number;
  discountPct: number;
  priceEach: number;
  lineTotal: number;
  lineVat: number;
  unitWeightKg?: number | null;
};

/** A quote pulled from text. Segment is never inferred from a Cin7 Core PDF. */
export type ExtractedQuote = {
  quoteNumber: string | null;
  customerName: string | null;
  postcode: string | null;
  salesContactName: string | null;
  salesContactEmail: string | null;
  orderNo: string | null;
  orderDate: string | null;
  terms: string | null;
  customerReference: string | null;
  currency: string | null;
  segment: null;
  lines: ExtractedLine[];
  goodsNet: number | null;
  additionalChargesNet: number | null;
  totalOrderNet: number | null;
  vat: number | null;
  total: number | null;
  /** Printed total weight, when the PDF states one. */
  totalWeightKg: number | null;
  warnings: string[];
};

/**
 * Pluggable quote reader. The Cin7 Core text parser is the default.
 * A later model-backed extractor can implement the same shape.
 */
export interface QuoteExtractor {
  id: string;
  extract(text: string): ExtractedQuote;
}
