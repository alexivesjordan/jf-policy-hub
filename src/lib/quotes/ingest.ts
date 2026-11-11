import { createHash } from "node:crypto";
import type { Cin7Quote } from "@/lib/cin7/types";
import { QUOTE_FLAG_CODES, type QuoteFlag } from "@/lib/quotes/flags";
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

export type ServiceReconcile = {
  goodsNet: number | null;
  orderNet: number | null;
  deliveryInstallLines: IngestedCharge[];
  flags: QuoteFlag[];
};

/** The goods net, order total, charges, and money flags the service page prices from. */
export function serviceReconcileFromCin7(quote: Cin7Quote): ServiceReconcile {
  const ingested = ingestCin7Quote(quote);
  return {
    goodsNet: ingested.goodsNet,
    orderNet: ingested.orderNet,
    deliveryInstallLines: ingested.deliveryInstallLines,
    flags: ingested.flags,
  };
}

export function serviceReconcileFromExtract(extracted: ExtractedQuote): ServiceReconcile {
  const ingested = ingestExtractedQuote(extracted, "pdf", "extract");
  return {
    goodsNet: ingested.goodsNet,
    orderNet: ingested.orderNet,
    deliveryInstallLines: ingested.deliveryInstallLines,
    flags: ingested.flags,
  };
}

export function serialiseServiceReconcile(value: ServiceReconcile) {
  return JSON.stringify(value);
}

export function parseServiceReconcile(raw: string): ServiceReconcile {
  const empty: ServiceReconcile = { goodsNet: null, orderNet: null, deliveryInstallLines: [], flags: [] };
  if (!raw.trim()) return empty;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceReconcile>;
    const money = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    const charges = Array.isArray(parsed.deliveryInstallLines)
      ? parsed.deliveryInstallLines.flatMap((line) => {
          if (!line || typeof line.description !== "string" || typeof line.amountNet !== "number" || !Number.isFinite(line.amountNet)) return [];
          return [{ description: line.description, amountNet: line.amountNet }];
        })
      : [];
    const flags = Array.isArray(parsed.flags)
      ? parsed.flags.flatMap((flag) => {
          if (!flag || typeof flag.code !== "string" || typeof flag.message !== "string") return [];
          if (!(QUOTE_FLAG_CODES as readonly string[]).includes(flag.code)) return [];
          const difference = flag.difference == null ? null : money(flag.difference);
          return [{ code: flag.code as QuoteFlag["code"], difference, message: flag.message }];
        })
      : [];
    return {
      goodsNet: money(parsed.goodsNet),
      orderNet: money(parsed.orderNet),
      deliveryInstallLines: charges,
      flags,
    };
  } catch {
    return empty;
  }
}

export function ingestDraft(draft: {
  source: IngestedQuote["source"];
  quoteNumber: string;
  customerName: string;
  postcode: string;
  goodsNet: number | null;
  orderNet?: number | null;
  lines: { sku: string; description: string; qty: number; lineTotal: number | null; category: string }[];
  warnings: string[];
  deliveryInstallLines?: IngestedCharge[];
  flags?: QuoteFlag[];
}): IngestedQuote {
  return {
    source: draft.source,
    cacheKey: quoteCacheKey(draft.source, `${draft.quoteNumber}:${draft.lines.map((line) => `${line.sku}:${line.qty}:${line.lineTotal}`).join("|")}`),
    quoteNumber: draft.quoteNumber,
    customerName: draft.customerName,
    siteName: null,
    postcode: draft.postcode || null,
    goodsNet: draft.goodsNet,
    orderNet: draft.orderNet ?? draft.goodsNet,
    lines: draft.lines.map((line) => ({
      sku: line.sku,
      description: line.description,
      qty: line.qty,
      lineNet: line.lineTotal ?? 0,
      cin7Category: line.category || null,
    })),
    deliveryInstallLines: draft.deliveryInstallLines ?? [],
    warnings: draft.warnings,
    flags: draft.flags ?? [],
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
