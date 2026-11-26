import { formatGbp } from "@/features/logistics/landed-cost/money";
import type { QuoteView } from "@/features/logistics/landed-cost/quote";
import type { ShipmentLineResult, ShipmentQuote } from "@/features/logistics/landed-cost/shipment";

function cell(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function row(values: (string | number | null | undefined)[]) {
  return values.map(cell).join(",");
}

export function quoteCsv(quote: QuoteView) {
  const header = ["Commodity", "Origin", "Destination", "Incoterm", "Customs value GBP", "Duty GBP", "Duty %", "VAT GBP", "VAT %", "Other charges GBP", "Landed cost GBP", "Per unit GBP", "Estimate", "Rate source", "Units per GBP"];
  const line = [
    quote.commodityCode,
    quote.origin,
    quote.destination,
    quote.incoterm,
    (quote.customsValuePence / 100).toFixed(2),
    (quote.dutyPence / 100).toFixed(2),
    quote.dutyPercent.toFixed(2),
    (quote.vatPence / 100).toFixed(2),
    quote.vatPercent.toFixed(2),
    (quote.otherChargesPence / 100).toFixed(2),
    (quote.landedPence / 100).toFixed(2),
    quote.perUnitPence == null ? "" : (quote.perUnitPence / 100).toFixed(2),
    quote.estimate ? "Estimate" : "",
    quote.rateSource,
    quote.unitsPerGbp,
  ];
  return `\uFEFF${row(header)}\n${row(line)}\n`;
}

export function shipmentCsv(shipment: ShipmentQuote) {
  const header = ["SKU", "Description", "Commodity", "Origin", "Quantity", "Customs value GBP", "Duty GBP", "VAT GBP", "Other charges GBP", "Landed cost GBP", "Per unit GBP", "Estimate", "Note"];
  const lines = shipment.lines.map((line) => lineRow(line));
  const totals = shipment.totals;
  const total = totals
    ? row(["", "Total", "", "", "", (totals.customsValuePence / 100).toFixed(2), (totals.dutyPence / 100).toFixed(2), (totals.vatPence / 100).toFixed(2), (totals.otherChargesPence / 100).toFixed(2), (totals.landedPence / 100).toFixed(2), "", shipment.estimate ? "Estimate" : "", ""])
    : "";
  return `\uFEFF${row(header)}\n${lines.join("\n")}${total ? `\n${total}` : ""}\n`;
}

function lineRow(line: ShipmentLineResult) {
  const result = line.result;
  return row([
    line.sku,
    line.description,
    line.hsCode,
    line.origin,
    line.quantity,
    result ? (result.customsValuePence / 100).toFixed(2) : "",
    result ? (result.dutyPence / 100).toFixed(2) : "",
    result ? (result.vatPence / 100).toFixed(2) : "",
    result ? (result.otherChargesPence / 100).toFixed(2) : "",
    result ? (result.landedPence / 100).toFixed(2) : "",
    result?.perUnitPence == null ? "" : (result.perUnitPence / 100).toFixed(2),
    result?.estimate ? "Estimate" : "",
    line.error ?? result?.dutyLabel ?? "",
  ]);
}

export function money(pence: number) {
  return formatGbp(pence);
}
