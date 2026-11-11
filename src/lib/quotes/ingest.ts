import { createHash } from "node:crypto";
import type { Cin7Quote } from "@/lib/cin7/types";
import type { QuoteFlag } from "@/lib/quotes/flags";
import { cin7CoreExtractor } from "@/lib/quotes/parse-cin7-core";
import { pdfBytesToLayoutText } from "@/lib/quotes/pdf-text";
import type { ExtractedQuote } from "@/lib/quotes/types";

export type IngestedLine = {
  sku: string;
  description: string;
  qty: number;
  lineNet: number;
  cin7Category: string | null;
};

export type IngestedCharge = {
  description: string;
  amountNet: number;
};

/** One normalised quote. Install pricing and warranty/servicing both read this. */
export type IngestedQuote = {
  source: "cin7" | "pdf" | "fixture";
  cacheKey: string;
  quoteNumber: string;
  customerName: string;
  siteName: string | null;
  postcode: string | null;
  goodsNet: number | null;
  orderNet: number | null;
  lines: IngestedLine[];
  deliveryInstallLines: IngestedCharge[];
  warnings: string[];
  /** Structured checks. Read `code` and `difference`; do not match `message`. */
  flags: QuoteFlag[];
  /** When a Cin7 order was fetched. Null for a PDF or a draft. */
  fetchedAt: string | null;
};

function round2(value: number) {
  return Math.sign(value) * Math.floor(Math.abs(value) * 100 + 0.5) / 100;
}

export function quoteCacheKey(source: string, material: string) {
  return `${source}:${createHash("sha256").update(material).digest("hex")}`;
}

export function ingestExtractedQuote(extracted: ExtractedQuote, source: IngestedQuote["source"], cacheMaterial: string): IngestedQuote {
  const delivery = extracted.additionalChargesNet
    ? [{ description: "Delivery and installation", amountNet: extracted.additionalChargesNet }]
    : [];
  return {
    source,
    cacheKey: quoteCacheKey(source, cacheMaterial),
    quoteNumber: extracted.quoteNumber ?? extracted.orderNo ?? "Not provided",
    customerName: extracted.customerName ?? "",
    siteName: null,
    postcode: extracted.postcode,
    goodsNet: extracted.goodsNet,
    orderNet: extracted.totalOrderNet ?? extracted.goodsNet,
    lines: extracted.lines.map((line) => ({
      sku: line.sku,
      description: line.description,
      qty: line.qty,
      lineNet: line.lineTotal,
      cin7Category: null,
    })),
    deliveryInstallLines: delivery,
    warnings: extracted.warnings,
    flags: [],
    fetchedAt: null,
  };
}

export function ingestDraft(draft: {
  source: IngestedQuote["source"];
  quoteNumber: string;
  customerName: string;
  postcode: string;
  goodsNet: number | null;
  lines: { sku: string; description: string; qty: number; lineTotal: number | null; category: string }[];
  warnings: string[];
}): IngestedQuote {
  return {
    source: draft.source,
    cacheKey: quoteCacheKey(draft.source, `${draft.quoteNumber}:${draft.lines.map((line) => `${line.sku}:${line.qty}:${line.lineTotal}`).join("|")}`),
    quoteNumber: draft.quoteNumber,
    customerName: draft.customerName,
    siteName: null,
    postcode: draft.postcode || null,
    goodsNet: draft.goodsNet,
    orderNet: draft.goodsNet,
    lines: draft.lines.map((line) => ({
      sku: line.sku,
      description: line.description,
      qty: line.qty,
      lineNet: line.lineTotal ?? 0,
      cin7Category: line.category || null,
    })),
    deliveryInstallLines: [],
    warnings: draft.warnings,
    flags: [],
    fetchedAt: null,
  };
}

export async function ingestPdfBytes(bytes: Uint8Array): Promise<IngestedQuote> {
  const material = Buffer.from(bytes).toString("base64");
  const text = await pdfBytesToLayoutText(bytes);
  const extracted = cin7CoreExtractor.extract(text);
  return ingestExtractedQuote(extracted, "pdf", material);
}

export function ingestCin7Quote(quote: Cin7Quote): IngestedQuote {
  const lines = quote.lines.map((line) => ({
    sku: line.sku ?? "",
    description: line.productName,
    qty: line.qty,
    lineNet: line.lineNet ?? 0,
    cin7Category: line.cin7Category ?? null,
  }));
  const goodsNet = round2(lines.reduce((sum, line) => sum + line.lineNet, 0));
  const deliveryInstallLines = (quote.additionalCharges ?? []).map((charge) => ({
    description: charge.description,
    amountNet: charge.amountNet,
  }));
  const chargeNet = round2(deliveryInstallLines.reduce((sum, charge) => sum + charge.amountNet, 0));
  return {
    source: "cin7",
    cacheKey: quoteCacheKey("cin7", quote.number.trim().toLowerCase()),
    quoteNumber: quote.number,
    customerName: quote.customerName,
    siteName: null,
    postcode: quote.postcode ?? null,
    goodsNet,
    orderNet: round2(goodsNet + chargeNet),
    lines,
    deliveryInstallLines,
    warnings: [],
    flags: quote.moneyFlags ?? [],
    fetchedAt: new Date().toISOString(),
  };
}
