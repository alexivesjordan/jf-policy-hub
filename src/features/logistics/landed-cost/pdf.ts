import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatGbp } from "@/features/logistics/landed-cost/money";
import type { QuoteView } from "@/features/logistics/landed-cost/quote";
import type { ShipmentQuote } from "@/features/logistics/landed-cost/shipment";

type Row = [string, string];

export async function quotePdf(quote: QuoteView, heading: string) {
  return renderPdf(heading, quote.estimate, rowsOf(quote));
}

export async function shipmentPdf(shipment: ShipmentQuote, heading: string) {
  const rows: Row[] = [];
  shipment.lines.forEach((line, index) => {
    const name = line.sku || line.description || `Line ${index + 1}`;
    if (!line.result) {
      rows.push([name, line.error ?? ""]);
      return;
    }
    rows.push([`${name} customs value`, formatGbp(line.result.customsValuePence)]);
    rows.push([`${name} duty`, formatGbp(line.result.dutyPence)]);
    rows.push([`${name} VAT`, formatGbp(line.result.vatPence)]);
    rows.push([`${name} landed`, formatGbp(line.result.landedPence)]);
  });
  if (shipment.totals) {
    rows.push(["Customs value", formatGbp(shipment.totals.customsValuePence)]);
    rows.push(["Duty", formatGbp(shipment.totals.dutyPence)]);
    rows.push(["VAT", formatGbp(shipment.totals.vatPence)]);
    rows.push(["Other charges", formatGbp(shipment.totals.otherChargesPence)]);
    rows.push(["Landed cost", formatGbp(shipment.totals.landedPence)]);
  }
  return renderPdf(heading, shipment.estimate, rows);
}

function rowsOf(quote: QuoteView): Row[] {
  const rows: Row[] = [
    ["Commodity", quote.commodityCode],
    ["Origin", quote.origin],
    ["Destination", quote.destination],
    ["Incoterm", quote.incoterm],
    ["Customs value", formatGbp(quote.customsValuePence)],
    [quote.dutyLabel, `${formatGbp(quote.dutyPence)} (${quote.dutyPercent.toFixed(2)}%)`],
  ];
  for (const charge of quote.additional) rows.push([charge.label, formatGbp(charge.pence)]);
  rows.push(["VAT", `${formatGbp(quote.vatPence)} (${quote.vatPercent.toFixed(2)}%)`]);
  rows.push(["Other charges", formatGbp(quote.otherChargesPence)]);
  rows.push(["Landed cost", formatGbp(quote.landedPence)]);
  if (quote.perUnitPence != null) rows.push(["Per unit", formatGbp(quote.perUnitPence)]);
  return rows;
}

async function renderPdf(heading: string, estimate: boolean, rows: Row[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [595, 842];
  let page = pdf.addPage(pageSize);
  let y = 800;
  const draw = (text: string, x: number, size: number, useBold = false) => {
    if (y < 48) {
      page = pdf.addPage(pageSize);
      y = 800;
    }
    page.drawText(text.slice(0, 110), { x, y, size, font: useBold ? bold : font, color: rgb(0.07, 0.07, 0.07) });
  };
  draw("Jordan Pulse", 48, 12, true);
  y -= 28;
  draw(heading, 48, 18, true);
  if (estimate) {
    y -= 18;
    draw("Estimate", 48, 11, true);
  }
  y -= 28;
  for (const [label, value] of rows) {
    draw(label, 48, 11);
    draw(value, 280, 11, label === "Landed cost");
    y -= 18;
  }
  return pdf.save();
}
