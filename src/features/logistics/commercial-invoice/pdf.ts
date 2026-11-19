import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  declaredTotal, goodsTotal, shippedLines, validateCommercialInvoice,
  type InvoiceDraft,
} from "./rules";

const A4: [number, number] = [595.28, 841.89];
const money = (value: number, currency: string) =>
  new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + " " + currency;

/**
 * Preview-only PDF. A production "Issue" workflow must persist a unique
 * immutable source snapshot and PDF before making the document available.
 */
export async function renderCommercialInvoicePdf(draft: InvoiceDraft): Promise<Uint8Array> {
  const problems = validateCommercialInvoice(draft);
  if (problems.length) throw new Error("Invoice cannot be rendered: " + problems.join("; "));
  const pdf = await PDFDocument.create();
  pdf.setTitle("Commercial Invoice " + draft.reference);
  pdf.setAuthor(draft.seller.name);
  pdf.setSubject("Commercial invoice preview — not an issued document");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.13, 0.17, 0.2);
  const muted = rgb(0.38, 0.43, 0.48);
  const light = rgb(0.88, 0.9, 0.92);
  const margin = 37;
  let page: PDFPage;
  let y = 0;
  let pageNumber = 0;
  const draw = (value: string, x: number, yy: number, size = 9, strong = false, maxWidth = 520) => {
    const font = strong ? bold : regular;
    // StandardFonts reject unsupported glyphs instead of silently corrupting
    // international addresses; proper Unicode font embedding is a release requirement.
    font.encodeText(value);
    page.drawText(value, { x, y: yy, size, font, color: strong ? ink : muted, maxWidth });
  };
  const horizontal = (at: number) => {
    page.drawLine({ start: { x: margin, y: at }, end: { x: A4[0] - margin, y: at }, thickness: 0.5, color: light });
  };
  const nextPage = () => {
    page = pdf.addPage(A4);
    pageNumber += 1;
    y = A4[1] - 46;
    draw(draft.seller.name, margin, y, 17, true);
    draw("COMMERCIAL INVOICE — PREVIEW", 323, y, 10, true, 235);
    y -= 18;
    horizontal(y);
    y -= 22;
    draw("Reference: " + draft.reference, margin, y, 9, true);
    draw("Date: " + draft.issueDate, 360, y);
    y -= 25;
    if (pageNumber > 1) {
      draw("Goods lines (continued)", margin, y, 10, true);
      y -= 26;
    }
  };
  const wrap = (value: string, maxChars = 65) => {
    const words = value.replace(/\s+/g, " ").trim().split(" ");
    const result: string[] = [];
    let line = "";
    for (const word of words) {
      if ((line + " " + word).trim().length > maxChars && line) {
        result.push(line); line = "";
      }
      if (word.length > maxChars) {
        if (line) { result.push(line); line = ""; }
        for (let i = 0; i < word.length; i += maxChars) result.push(word.slice(i, i + maxChars));
      } else line = [line, word].filter(Boolean).join(" ");
    }
    if (line) result.push(line);
    return result.length ? result : [""];
  };
  const section = (title: string, value: string) => {
    if (y < 120) nextPage();
    draw(title, margin, y, 9, true);
    y -= 15;
    for (const line of wrap(value, 95)) {
      if (y < 75) nextPage();
      draw(line, margin, y, 9, false);
      y -= 12;
    }
    y -= 7;
  };
  nextPage();
  const party = (name: string, p: typeof draft.buyer) => [
    p.name, p.address, p.vat ? "VAT " + p.vat : "", p.eori ? "EORI " + p.eori : "",
  ].filter(Boolean).join(" | ");
  section("Exporter", party("Exporter", draft.seller));
  section("Buyer", party("Buyer", draft.buyer));
  section("Consignee", party("Consignee", draft.consignee));
  section("Importer of record", party("Importer", draft.importer));
  section("Shipment", [
    "Orders: " + draft.orders.join(", "),
    "Carrier: " + draft.carrier,
    "Incoterm: " + draft.incoterm + " " + draft.namedPlace,
    "Destination: " + draft.destinationCountry,
    draft.clearanceCountry ? "Customs clearance: " + draft.clearanceCountry : "",
    "Shipment reference: " + (draft.shipmentRef || "Not supplied"),
    "Reason for export: " + draft.reasonForExport,
  ].filter(Boolean).join(" | "));

  if (y < 140) nextPage();
  draw("ORDER", margin, y, 7, true);
  draw("SKU / ITEM", 107, y, 7, true);
  draw("QTY", 365, y, 7, true);
  draw("LINE VALUE", 435, y, 7, true);
  y -= 12;
  horizontal(y);
  y -= 18;
  for (const line of shippedLines(draft)) {
    const descriptions = wrap(line.productName, 47);
    const height = Math.max(58, 20 + descriptions.length * 11);
    if (y - height < 115) {
      nextPage();
      draw("ORDER", margin, y, 7, true);
      draw("SKU / ITEM", 107, y, 7, true);
      draw("QTY", 365, y, 7, true);
      draw("LINE VALUE", 435, y, 7, true);
      y -= 12; horizontal(y); y -= 18;
    }
    draw(line.orderNumber, margin, y, 8);
    draw(line.sku.slice(0, 41), 107, y, 8, true);
    draw(String(line.shippedQuantity), 365, y, 8);
    draw(money(line.shippedQuantity * line.unitNetValue, draft.currency), 435, y, 8, true, 125);
    y -= 13;
    for (const text of descriptions) { draw(text, 107, y, 8); y -= 11; }
    draw("HS " + line.hsCode + " | Origin " + line.originCountry + " | Unit " + money(line.unitNetValue, draft.currency), 107, y, 7);
    y -= 18;
    horizontal(y);
    y -= 12;
  }
  if (y < 260) nextPage();
  section("Packages and mass",
    draft.packages + " " + draft.packageType + " | Net " + draft.netWeightKg.toFixed(2) +
    " kg | Gross " + draft.grossWeightKg.toFixed(2) + " kg");
  const rows: [string, number][] = [
    ["Goods", goodsTotal(draft)],
    ["Freight", draft.freightValue],
    ["Insurance", draft.insuranceValue],
    ["Other charges", draft.otherChargesValue],
    ["DECLARED TOTAL", declaredTotal(draft)],
  ];
  for (const [label, amount] of rows) {
    if (y < 100) nextPage();
    draw(label, margin, y, 9, label === "DECLARED TOTAL");
    draw(money(amount, draft.currency), 420, y, 9, label === "DECLARED TOTAL");
    y -= 18;
  }
  y -= 12;
  if (draft.approvedStatement.trim()) section("Approved customs statement", draft.approvedStatement);
  if (draft.notes.trim()) section("Additional notes", draft.notes);
  if (y < 110) nextPage();
  draw("Approved signatory: " + draft.signatory, margin, y, 9, true);
  y -= 15;
  draw("PREVIEW ONLY — NOT AN ISSUED COMMERCIAL INVOICE", margin, y, 8, true);
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText("Jordan Pulse Logistics • Preview • Page " + (i + 1) + " of " + pages.length, {
      x: margin, y: 27, font: regular, size: 8, color: muted,
    });
  });
  return pdf.save();
}
