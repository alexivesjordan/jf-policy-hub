import { looksLikeUkPostcode, normaliseUkPostcode } from "@/lib/quotes/postcode";
import type { ExtractedLine, ExtractedQuote, QuoteExtractor } from "@/lib/quotes/types";

const HEADER_LABELS = ["Order No", "Date", "Terms", "Customer Reference", "Currency"] as const;

function money(value: string): number {
  return Number(value.replace(/,/g, "").replace(/%$/, ""));
}

function isSkuFragment(value: string): boolean {
  return /^[A-Z0-9][A-Z0-9.-]{0,16}$/.test(value);
}

const NUMERIC_TAIL = /^(.*?)(?:\s+)(\d+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)%?\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)$/;

function isNumericRow(line: string): boolean {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 6) return false;
  return parts.slice(0, 6).every((part) => /^[\d,]+(?:\.\d+)?%?$/.test(part));
}

function isFurniture(line: string): boolean {
  return (
    /^this quotation is valid for 30 days\.?$/i.test(line) ||
    /^printed:.*page \d+ of \d+/i.test(line) ||
    /^#?\s*sku\b.*product description/i.test(line)
  );
}

function blockLines(lines: string[], start: number, end: number): string[] {
  return lines.slice(start, end).map((line) => line.trim()).filter(Boolean);
}

function party(lines: string[]) {
  const postcodeLine = [...lines].reverse().find((line) => looksLikeUkPostcode(line));
  const name = lines.find((line) => line !== postcodeLine) ?? null;
  return {
    name,
    postcode: postcodeLine ? normaliseUkPostcode(postcodeLine) : null,
  };
}

function takeNumbers(line: string): { head: string; numeric: string[] } | null {
  if (isNumericRow(line)) return { head: "", numeric: line.trim().split(/\s+/).slice(0, 6) };
  const tail = line.match(NUMERIC_TAIL);
  if (!tail) return null;
  return { head: (tail[1] ?? "").trim(), numeric: tail.slice(2, 8) };
}

function parseLines(rows: string[]): ExtractedLine[] {
  const lines: ExtractedLine[] = [];
  let index = 0;
  while (index < rows.length) {
    const raw = rows[index] ?? "";
    const inline = takeNumbers(raw);
    const head = inline?.head ?? raw;
    const start = head.match(/^(\d+)\s+(.+)$/);
    if (!start || (inline && !inline.head && isNumericRow(raw))) {
      index += 1;
      continue;
    }
    if (/^\d+\s+[\d,]+/.test(head) && isNumericRow(head)) {
      index += 1;
      continue;
    }
    let sku = "";
    const description: string[] = [];
    const firstTokens = start[2].trim().split(/\s+/);
    const firstSku = firstTokens[0] ?? "";
    if (isSkuFragment(firstSku)) {
      sku = firstSku;
      if (firstTokens.length > 1) description.push(firstTokens.slice(1).join(" "));
    } else if (start[2].trim()) {
      description.push(start[2].trim());
    }
    let numeric = inline?.numeric ?? null;
    index += 1;
    while (index < rows.length) {
      const current = rows[index] ?? "";
      if (/^\d+\s+[A-Za-z]/.test(current)) break;
      const nextNumbers = takeNumbers(current);
      if (!numeric && nextNumbers && !nextNumbers.head) {
        numeric = nextNumbers.numeric;
        index += 1;
        continue;
      }
      const text = (nextNumbers?.head || current).trim();
      if (!text) {
        index += 1;
        continue;
      }
      const tokens = text.split(/\s+/);
      const fragment = tokens[0] ?? "";
      const colourSuffix = /[0-9]$/.test(sku) && /^[A-Z]{2,4}$/.test(fragment);
      const continueSku = isSkuFragment(fragment) && (sku.endsWith("-") || colourSuffix || (description.length === 0 && tokens.length === 1));
      if (continueSku) {
        sku = `${sku}${fragment}`;
        if (tokens.length > 1) description.push(tokens.slice(1).join(" "));
      } else {
        description.push(text);
      }
      if (!numeric && nextNumbers?.numeric) numeric = nextNumbers.numeric;
      index += 1;
    }
    if (!numeric) continue;
    lines.push({
      lineNo: Number(start[1]),
      sku,
      description: description.join(" ").replace(/\s+/g, " ").trim(),
      qty: money(numeric[0] ?? "0"),
      rsp: money(numeric[1] ?? "0"),
      discountPct: money(numeric[2] ?? "0"),
      priceEach: money(numeric[3] ?? "0"),
      lineTotal: money(numeric[4] ?? "0"),
      lineVat: money(numeric[5] ?? "0"),
    });
  }
  return lines;
}

function labelledAmount(text: string, label: string): number | null {
  const match = text.match(new RegExp(`(?:^|\\n)\\s*${label}:?\\s+([\\d,]+\\.\\d{2})`, "i"));
  return match ? money(match[1] ?? "") : null;
}

/** Read a Cin7 Core quote from pdftotext-style layout text. */
export function parseCin7CoreQuote(text: string): ExtractedQuote {
  const warnings: string[] = [];
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isFurniture(line));

  const quoteMatch = text.match(/Quote No:\s*([A-Z0-9-]+)/i);
  const customerAt = lines.findIndex((line) => line.toLowerCase() === "customer");
  const deliveryAt = lines.findIndex((line) => line.toLowerCase() === "delivery address");
  const salesAt = lines.findIndex((line) => line.toLowerCase() === "sales contact");
  const orderAt = lines.findIndex((line) => line.toLowerCase() === "order no");

  const customer = customerAt >= 0 ? party(blockLines(lines, customerAt + 1, deliveryAt > customerAt ? deliveryAt : customerAt + 6)) : { name: null, postcode: null };
  const deliveryEnd = salesAt > deliveryAt ? salesAt : orderAt > deliveryAt ? orderAt : deliveryAt + 6;
  const delivery = deliveryAt >= 0 ? party(blockLines(lines, deliveryAt + 1, deliveryEnd)) : { name: null, postcode: null };
  const salesLines = salesAt >= 0 && orderAt > salesAt ? blockLines(lines, salesAt + 1, orderAt) : [];
  const email = salesLines.find((line) => line.includes("@")) ?? null;
  const salesName = salesLines.find((line) => line !== email) ?? null;

  let values: string[] = [];
  if (orderAt >= 0) {
    const labels = lines.slice(orderAt, orderAt + HEADER_LABELS.length);
    const labelsMatch = HEADER_LABELS.every((label, index) => labels[index]?.toLowerCase() === label.toLowerCase());
    if (!labelsMatch) warnings.push("Header labels were not in the expected Order No, Date, Terms, Customer Reference, Currency order.");
    values = lines.slice(orderAt + HEADER_LABELS.length, orderAt + HEADER_LABELS.length + HEADER_LABELS.length);
  } else {
    warnings.push("Order No header was not found.");
  }

  const tableStart = orderAt >= 0 ? orderAt + HEADER_LABELS.length * 2 : 0;
  const goodsAt = lines.findIndex((line, index) => index >= tableStart && /^goods net\b/i.test(line));
  const table = parseLines(lines.slice(tableStart, goodsAt === -1 ? undefined : goodsAt));
  const totalsText = lines.slice(goodsAt === -1 ? lines.length : goodsAt).join("\n");
  const goodsNet = labelledAmount(totalsText, "Goods Net");
  const additionalChargesNet = labelledAmount(totalsText, "Additional Charges Net");
  const totalOrderNet = labelledAmount(totalsText, "Total Order Net");
  const vat = labelledAmount(totalsText, "VAT");
  const total = labelledAmount(totalsText, "Total");
  const lineSum = Math.round(table.reduce((sum, line) => sum + line.lineTotal, 0) * 100) / 100;

  if (table.length === 0) warnings.push("No quote lines were read from the table.");
  if (goodsNet == null) warnings.push("Goods Net was not found.");
  if (goodsNet != null && Math.abs(lineSum - goodsNet) > 0.009) {
    warnings.push(`Line totals sum to ${lineSum.toFixed(2)} but Goods Net is ${goodsNet.toFixed(2)}.`);
  }

  return {
    quoteNumber: quoteMatch?.[1] ?? values[0] ?? null,
    customerName: customer.name,
    postcode: delivery.postcode ?? customer.postcode,
    salesContactName: salesName,
    salesContactEmail: email,
    orderNo: values[0] ?? null,
    orderDate: values[1] ?? null,
    terms: values[2] ?? null,
    customerReference: values[3] ?? null,
    currency: values[4] ?? null,
    segment: null,
    lines: table,
    goodsNet,
    additionalChargesNet,
    totalOrderNet,
    vat,
    total,
    warnings,
  };
}

export const cin7CoreExtractor: QuoteExtractor = {
  id: "cin7-core-text",
  extract: parseCin7CoreQuote,
};
