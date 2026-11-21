import { access, readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { degrees, PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { COMMERCIAL_INVOICE_MARKS, COMMERCIAL_INVOICE_SELLER, resolveCustomsStatement } from "./seller";
import {
  chargedLinePence, countryName, lineWeightKg, normaliseHsCode, shippedLines, validateCommercialInvoice,
  type GoodsLine, type InvoiceDraft, type InvoiceShipment,
} from "./rules";

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 28;
const FOOTER = 42;
const BOTTOM = MARGIN + FOOTER;
const CONTENT_W = A4[0] - MARGIN * 2;

const COLS = [
  { key: "sku", label: "Our Part Code", w: 72 },
  { key: "desc", label: "Description", w: 120 },
  { key: "order", label: "Order No", w: 50 },
  { key: "hs", label: "Commodity Code", w: 64 },
  { key: "total", label: "Line Total", w: 48 },
  { key: "vat", label: "Line VAT", w: 38 },
  { key: "weight", label: "Weight", w: 50 },
  { key: "qty", label: "Qty This Delivery", w: 48 },
  { key: "origin", label: "Country of Origin", w: CONTENT_W - 490 },
] as const;

export type InvoicePageRole = "first" | "continuation" | "last";
export type InvoicePagePlan = { role: InvoicePageRole; from: number; to: number; summary: boolean };

const ink = rgb(0.1, 0.1, 0.1);
const grey = rgb(0.42, 0.42, 0.42);
const line = rgb(0.25, 0.25, 0.25);
const wash = rgb(0.9, 0.9, 0.9);

const CURRENCY_NAMES: Record<string, string> = {
  GBP: "Pound sterling",
  EUR: "Euro",
  USD: "US dollar",
  CHF: "Swiss franc",
  PLN: "Polish zloty",
};

function money(pence: number) {
  return new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(pence / 100);
}

function kilos(kg: number) {
  return kg.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " Kg";
}

function grossKilos(kg: number) {
  return kg.toLocaleString("en-GB", { maximumFractionDigits: 2 }) + " Kg";
}

function currencyName(code: string) {
  return CURRENCY_NAMES[code] ?? code;
}

function dmy(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

function printedStamp(iso: string) {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("weekday")}, ${get("day")}/${get("month")}/${get("year")} (${get("hour")}:${get("minute")})`;
}

function shipmentOf(draft: InvoiceDraft): InvoiceShipment {
  const base: InvoiceShipment = {
    fao: "",
    courier: draft.carrier === "Other" ? "" : draft.carrier,
    despatchDate: draft.issueDate,
    deliveryAddress: draft.consignee.address,
    contactName: "",
    contactEmail: "",
    specialInstructions: draft.notes,
    parcels: draft.packages,
    pallets: 0,
    dimensions: [],
    deliveryPence: Math.round((draft.freightValue || 0) * 100),
    surchargePence: Math.round((draft.otherChargesValue || 0) * 100),
    vatPence: 0,
    customsStatementId: draft.approvedStatement ? "custom" : "none",
    customsStatementText: draft.approvedStatement,
    issuedAt: new Date().toISOString(),
  };
  return { ...base, ...draft.shipment, dimensions: draft.shipment?.dimensions ?? base.dimensions };
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words.length ? words : [""]) {
    const next = current ? current + " " + word : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    if (font.widthOfTextAtSize(word, size) <= width) {
      current = word;
      continue;
    }
    let piece = "";
    for (const char of word) {
      if (font.widthOfTextAtSize(piece + char, size) > width && piece) {
        lines.push(piece);
        piece = char;
      } else piece += char;
    }
    current = piece;
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

type Measured = { line: GoodsLine; height: number; description: string[]; origin: string[] };

function measure(rows: GoodsLine[], font: PDFFont): Measured[] {
  const descW = COLS[1].w - 4;
  const originW = COLS[8].w - 4;
  return rows.map((row) => {
    const description = wrap(row.productName, font, 7, descW);
    const origin = wrap(countryName(row.originCountry), font, 7, originW);
    const body = Math.max(description.length, origin.length, 1) * 9;
    return { line: row, height: body + 12, description, origin };
  });
}

function take(rows: Measured[], from: number, capacity: number) {
  let used = 0;
  let index = from;
  while (index < rows.length && (used + rows[index]!.height <= capacity || index === from)) {
    used += rows[index]!.height;
    index += 1;
  }
  return index;
}

function fits(rows: Measured[], from: number, to: number, capacity: number) {
  let used = 0;
  for (let index = from; index < to; index += 1) used += rows[index]!.height;
  return used <= capacity;
}

const FIRST_TOP = 290;
const CONT_TOP = 78;

function summaryHeight(draft: InvoiceDraft) {
  const shipment = shipmentOf(draft);
  const statement = resolveCustomsStatement(shipment.customsStatementId, shipment.customsStatementText) || shipment.customsStatementText;
  const statementLines = statement ? statement.split("\n").reduce((count, part) => count + Math.max(1, Math.ceil(part.length / 100)), 0) : 0;
  return 20 + shipment.dimensions.length * 11 + statementLines * 12 + 196;
}

export function planCommercialInvoice(draft: InvoiceDraft, font: PDFFont): InvoicePagePlan[] {
  const rows = measure(shippedLines(draft), font);
  const summary = summaryHeight(draft);
  const firstRoom = A4[1] - FIRST_TOP - BOTTOM;
  const contRoom = A4[1] - CONT_TOP - BOTTOM;
  const pages: InvoicePagePlan[] = [];
  if (fits(rows, 0, rows.length, firstRoom - summary)) {
    return [{ role: "first", from: 0, to: rows.length, summary: true }];
  }
  const firstEnd = take(rows, 0, firstRoom);
  pages.push({ role: "first", from: 0, to: firstEnd, summary: false });
  let cursor = firstEnd;
  while (cursor < rows.length || pages[pages.length - 1]?.summary !== true) {
    if (cursor >= rows.length) {
      pages.push({ role: "last", from: cursor, to: cursor, summary: true });
      break;
    }
    if (fits(rows, cursor, rows.length, contRoom - summary)) {
      pages.push({ role: "last", from: cursor, to: rows.length, summary: true });
      break;
    }
    const end = take(rows, cursor, contRoom);
    pages.push({ role: "continuation", from: cursor, to: end, summary: false });
    cursor = end;
  }
  return pages;
}

/** `top` is the PDF y of the top edge. The SVG path is flipped, so it extends downward by `h`. */
function roundBox(page: PDFPage, x: number, top: number, w: number, h: number) {
  const r = Math.min(4, h / 2, w / 2);
  const path = [
    `M ${r} 0`,
    `L ${w - r} 0`,
    `Q ${w} 0 ${w} ${r}`,
    `L ${w} ${h - r}`,
    `Q ${w} ${h} ${w - r} ${h}`,
    `L ${r} ${h}`,
    `Q 0 ${h} 0 ${h - r}`,
    `L 0 ${r}`,
    `Q 0 0 ${r} 0`,
    "Z",
  ].join(" ");
  page.drawSvgPath(path, { x, y: top, borderColor: line, borderWidth: 0.6 });
}

async function optionalImage(pdf: PDFDocument, file: string) {
  try {
    await access(path.join(process.cwd(), file));
    const bytes = await readFile(path.join(process.cwd(), file));
    return file.endsWith(".png") ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
  } catch {
    return null;
  }
}

export async function renderCommercialInvoicePdf(draft: InvoiceDraft): Promise<Uint8Array> {
  const problems = validateCommercialInvoice(draft);
  if (problems.length) throw new Error("Invoice cannot be rendered: " + problems.join("; "));
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const preview = draft.reference === "PREVIEW";
  pdf.setTitle((preview ? "Preview " : "") + "Commercial Invoice " + draft.reference);
  pdf.setAuthor(COMMERCIAL_INVOICE_SELLER.name);
  const fontDir = path.join(process.cwd(), "src/features/logistics/commercial-invoice/fonts");
  const regular = await pdf.embedFont(await readFile(path.join(fontDir, "NotoSans-Regular.ttf")), { subset: true });
  const bold = await pdf.embedFont(await readFile(path.join(fontDir, "NotoSans-Bold.ttf")), { subset: true });
  const logo = await pdf.embedPng(await readFile(path.join(process.cwd(), "public/brand/jordan-wordmark.png")));
  const signature = await optionalImage(pdf, COMMERCIAL_INVOICE_MARKS.signatureFile);
  const stamp = await optionalImage(pdf, COMMERCIAL_INVOICE_MARKS.stampFile);
  const plan = planCommercialInvoice(draft, regular);
  const rows = measure(shippedLines(draft), regular);
  const shipment = shipmentOf(draft);
  const statement = resolveCustomsStatement(shipment.customsStatementId, shipment.customsStatementText) || shipment.customsStatementText;
  const goods = shippedLines(draft).reduce((sum, row) => sum + chargedLinePence(row), 0);
  const net = goods + shipment.deliveryPence + shipment.surchargePence;
  const total = net + shipment.vatPence;
  const origins = [...new Set(shippedLines(draft).map((row) => countryName(row.originCountry)).filter(Boolean))].join(", ");
  const pages = plan.map(() => pdf.addPage(A4));

  const text = (page: PDFPage, value: string, x: number, y: number, size: number, font: PDFFont, color = ink, maxWidth?: number) => {
    if (!value) return;
    page.drawText(value, { x, y, size, font, color, maxWidth });
  };
  const aligned = (page: PDFPage, value: string, x: number, y: number, w: number, size: number, font: PDFFont, align: "left" | "right" | "center", color = ink) => {
    const width = font.widthOfTextAtSize(value, size);
    const left = align === "right" ? x + w - width - 3 : align === "center" ? x + (w - width) / 2 : x + 3;
    text(page, value, left, y, size, font, color);
  };

  const footer = (page: PDFPage, index: number) => {
    text(page, "VAT Registration No: " + COMMERCIAL_INVOICE_SELLER.vat.replace(/^GB/, ""), MARGIN, 30, 8, regular);
    text(page, "Company Reg. No: " + COMMERCIAL_INVOICE_SELLER.companyNumber, MARGIN, 18, 8, regular);
    const printed = "Printed:  " + printedStamp(shipment.issuedAt);
    const pageNo = "Page:  " + (index + 1) + " of " + pages.length;
    text(page, printed, A4[0] - MARGIN - regular.widthOfTextAtSize(printed, 8), 30, 8, regular);
    text(page, pageNo, A4[0] - MARGIN - regular.widthOfTextAtSize(pageNo, 8), 18, 8, regular);
  };

  const tableHeader = (page: PDFPage, y: number) => {
    const headerLines = COLS.map((column) => wrap(column.label, bold, 6.5, column.w - 6));
    const rowsHigh = Math.max(...headerLines.map((lines) => lines.length));
    const top = y + 4;
    const height = 8 + rowsHigh * 8 + 4;
    roundBox(page, MARGIN, top, CONTENT_W, height);
    let x = MARGIN;
    headerLines.forEach((lines, index) => {
      lines.forEach((part, lineNo) => aligned(page, part, x, top - 12 - lineNo * 8, COLS[index]!.w, 6.5, bold, "center"));
      x += COLS[index]!.w;
    });
    return top - height - 4;
  };

  const drawRows = (page: PDFPage, y: number, from: number, to: number) => {
    for (let index = from; index < to; index += 1) {
      const row = rows[index]!;
      let x = MARGIN + 3;
      const top = y - 9;
      text(page, row.line.sku, x, top, 7, regular, ink, COLS[0].w - 4);
      row.description.forEach((part, lineNo) => text(page, part, x + COLS[0].w, top - lineNo * 9, 7, regular, ink, COLS[1].w - 4));
      const numeric: [string, "left" | "right" | "center"][] = [
        [row.line.orderNumber, "right"],
        [normaliseHsCode(row.line.hsCode) ?? row.line.hsCode, "right"],
        [money(chargedLinePence(row.line)), "right"],
        [money(0), "right"],
        [kilos(lineWeightKg(row.line)), "right"],
        [row.line.shippedQuantity.toFixed(2), "center"],
      ];
      let cursor = x + COLS[0].w + COLS[1].w;
      numeric.forEach(([value, align], valueIndex) => {
        aligned(page, value, cursor, top, COLS[valueIndex + 2]!.w, 7, regular, align);
        cursor += COLS[valueIndex + 2]!.w;
      });
      row.origin.forEach((part, lineNo) => aligned(page, part, cursor, top - lineNo * 9, COLS[8].w, 7, regular, "center"));
      const unitPence = row.line.shippedQuantity > 0 ? Math.round(chargedLinePence(row.line) / row.line.shippedQuantity) : 0;
      const price = "Item Price: " + money(unitPence);
      const totalX = MARGIN + COLS[0].w + COLS[1].w + COLS[2].w + COLS[3].w;
      aligned(page, price, totalX - 36, y - row.height + 3, COLS[4].w + 36, 6.5, regular, "right", grey);
      page.drawLine({ start: { x: MARGIN, y: y - row.height }, end: { x: A4[0] - MARGIN, y: y - row.height }, thickness: 0.4, color: line });
      y -= row.height;
    }
    return y;
  };

  const letterhead = (page: PDFPage) => {
    let y = A4[1] - 36;
    text(page, COMMERCIAL_INVOICE_SELLER.name, MARGIN, y, 12, bold);
    const address = [
      ...COMMERCIAL_INVOICE_SELLER.lines,
      COMMERCIAL_INVOICE_SELLER.phone,
      COMMERCIAL_INVOICE_SELLER.website,
      COMMERCIAL_INVOICE_SELLER.email,
      "EORI number: " + COMMERCIAL_INVOICE_SELLER.eoriGb + " & " + COMMERCIAL_INVOICE_SELLER.eoriFr,
    ];
    address.forEach((part, index) => text(page, part, MARGIN, y - 14 - index * 10, 8, regular));
    const logoW = 150;
    const logoH = logoW * (logo.height / logo.width);
    page.drawImage(logo, { x: A4[0] - MARGIN - logoW, y: y - logoH + 14, width: logoW, height: logoH });
    const boxTop = y - 132;
    const gap = 8;
    const rightW = 176;
    const leftW = (CONTENT_W - rightW - gap * 2) / 2;
    const customer = [
      draft.buyer.name,
      ...draft.buyer.address.split(/\n|, /).map((part) => part.trim()).filter(Boolean),
      draft.buyer.vat ? "VAT No: " + draft.buyer.vat : "",
      draft.buyer.eori ? "EORI No: " + draft.buyer.eori : "",
    ].filter(Boolean);
    const delivery = [
      shipment.fao ? "FAO " + shipment.fao : "",
      ...shipment.deliveryAddress.split(/\n|, /).map((part) => part.trim()).filter(Boolean),
    ].filter(Boolean);
    const invoiceBand = 26;
    const boxH = Math.max(118, 30 + Math.max(customer.length, delivery.length) * 10);
    const boxes: [number, number, string, string[]][] = [
      [MARGIN, leftW, "Customer Name & Address", customer],
      [MARGIN + leftW + gap, leftW, "Delivery Address", delivery],
    ];
    for (const [x, w, title, body] of boxes) {
      roundBox(page, x, boxTop, w, boxH);
      text(page, title, x + 8, boxTop - 16, 8, bold);
      body.slice(0, 8).forEach((part, index) => text(page, part, x + 8, boxTop - 30 - index * 10, 7.5, regular, ink, w - 16));
    }
    const rx = A4[0] - MARGIN - rightW;
    roundBox(page, rx, boxTop, rightW, boxH);
    const title = "COMMERCIAL INVOICE";
    text(page, title, rx + (rightW - bold.widthOfTextAtSize(title, 8)) / 2, boxTop - 16, 8, bold);
    page.drawLine({ start: { x: rx, y: boxTop - 22 }, end: { x: rx + rightW, y: boxTop - 22 }, thickness: 0.6, color: line });
    const meta: [string, string][] = [
      ["FAO:", shipment.fao],
      ["Courier:", shipment.courier],
      ["Despatch Date:", dmy(shipment.despatchDate)],
    ];
    meta.forEach(([label, value], index) => {
      const rowY = boxTop - 38 - index * 14;
      text(page, label, rx + 8, rowY, 8, bold);
      aligned(page, value, rx, rowY, rightW, 8, regular, "right");
    });
    const split = boxTop - boxH + invoiceBand;
    page.drawLine({ start: { x: rx, y: split }, end: { x: rx + rightW, y: split }, thickness: 0.6, color: line });
    text(page, "Invoice No:", rx + 8, split - 16, 8, bold);
    aligned(page, preview ? "PREVIEW" : draft.reference, rx, split - 16, rightW, 8, regular, "right");
    return boxTop - boxH - 14;
  };

  const summary = (page: PDFPage, y: number) => {
    let cursor = y - 14;
    if (shipment.dimensions.length) {
      text(page, "Dimensions:", MARGIN, cursor, 9, bold);
      cursor -= 12;
      for (const item of shipment.dimensions) {
        text(page, `${item.lengthCm} x ${item.widthCm} x ${item.heightCm} = ${item.weightKg}kg`, MARGIN, cursor, 8, regular);
        cursor -= 11;
      }
      cursor -= 4;
    }
    if (statement) {
      for (const part of statement.split("\n")) {
        for (const wrapped of wrap(part, regular, 8, CONTENT_W)) {
          text(page, wrapped, MARGIN, cursor, 8, regular);
          cursor -= 11;
        }
      }
      cursor -= 6;
    }
    const boxW = (CONTENT_W - 16) / 3;
    const instructions = [
      "Country of origin: " + origins,
      "Country of export: United Kingdom",
      "Incoterms: " + draft.incoterm,
      shipment.contactName ? "Contact: " + shipment.contactName : "",
      shipment.contactEmail ? "Email: " + shipment.contactEmail : "",
      shipment.specialInstructions,
    ].filter(Boolean);
    const middle: [string, string][] = [
      ["No. of parcels:", shipment.parcels.toFixed(2)],
      ["No. of pallets:", shipment.pallets.toFixed(2)],
      ["Total net weight:", kilos(shippedLines(draft).reduce((sum, row) => sum + lineWeightKg(row), 0))],
      ["Total gross weight:", grossKilos(draft.grossWeightKg)],
    ];
    const totals: [string, string, boolean][] = [
      ["Goods Net:", money(goods), false],
      ["Delivery:", money(shipment.deliveryPence), false],
      ["Surcharge:", money(shipment.surchargePence), false],
      ["Net:", money(net), false],
      ["VAT:", money(shipment.vatPence), false],
      ["Total:", money(total), true],
    ];
    const boxH = Math.max(108, 22 + instructions.length * 11 + 12, 16 + middle.length * 14 + 12, 16 + totals.length * 13 + 22);
    const boxTop = cursor - 6;
    const labelValue = (x: number, rowY: number, label: string, value: string, strong = false) => {
      text(page, label, x + 8, rowY, 7.5, strong ? bold : regular);
      aligned(page, value, x, rowY, boxW, 7.5, strong ? bold : regular, "right");
    };
    roundBox(page, MARGIN, boxTop, boxW, boxH);
    text(page, "Special Instructions", MARGIN + 8, boxTop - 16, 8, bold);
    instructions.forEach((part, index) => {
      wrap(part, regular, 7.5, boxW - 16).forEach((wrapped, lineNo) => {
        text(page, wrapped, MARGIN + 8, boxTop - 30 - index * 11 - lineNo * 9, 7.5, regular, ink, boxW - 16);
      });
    });
    const midX = MARGIN + boxW + 8;
    roundBox(page, midX, boxTop, boxW, boxH);
    middle.forEach(([label, value], index) => labelValue(midX, boxTop - 18 - index * 16, label, value));
    const rightX = MARGIN + (boxW + 8) * 2;
    roundBox(page, rightX, boxTop, boxW, boxH);
    totals.forEach(([label, value, strong], index) => labelValue(rightX, boxTop - 16 - index * 13, label, value, strong));
    const currency = currencyName(draft.currency);
    text(page, currency, rightX + (boxW - regular.widthOfTextAtSize(currency, 7.5)) / 2, boxTop - boxH + 10, 7.5, regular);

    const signTop = boxTop - boxH - 12;
    const signH = 78;
    const stampW = 150;
    const signW = CONTENT_W - stampW - 8;
    roundBox(page, MARGIN, signTop, signW, signH);
    const underline = (label: string, x: number, rowY: number, width: number) => {
      text(page, label, x, rowY, 8, regular);
      const start = x + regular.widthOfTextAtSize(label, 8) + 6;
      page.drawLine({ start: { x: start, y: rowY - 1 }, end: { x: x + width, y: rowY - 1 }, thickness: 0.4, color: line });
    };
    underline("Signed:", MARGIN + 8, signTop - 18, signW / 2 - 16);
    if (signature) page.drawImage(signature, { x: MARGIN + 58, y: signTop - 28, width: 80, height: 22 });
    underline("Name:", MARGIN + 8, signTop - 40, signW / 2 - 20);
    underline("Position:", MARGIN + signW / 2, signTop - 40, signW / 2 - 16);
    underline("Date:", MARGIN + 8, signTop - 62, signW / 2 - 20);
    roundBox(page, MARGIN + signW + 8, signTop, stampW, signH);
    text(page, "Company stamp", MARGIN + signW + 16, signTop - 16, 8, regular, grey);
    if (stamp) page.drawImage(stamp, { x: MARGIN + signW + 20, y: signTop - signH + 10, width: stampW - 24, height: 40 });
  };

  pages.forEach((page, index) => {
    const item = plan[index]!;
    if (preview) {
      page.drawText("PREVIEW", { x: 150, y: 360, size: 72, font: bold, color: wash, rotate: degrees(32) });
    }
    let y = A4[1] - 28;
    if (item.role === "first") y = letterhead(page);
    else {
      const title = "Document No: " + (preview ? "PREVIEW" : draft.reference) + ", Customer: " + draft.buyer.name;
      text(page, title, MARGIN, y, 11, bold, ink, CONTENT_W);
      y -= 16;
    }
    if (item.to > item.from) {
      y = tableHeader(page, y);
      y = drawRows(page, y, item.from, item.to);
    }
    if (item.summary) summary(page, y - 8);
    footer(page, index);
  });
  return pdf.save();
}
