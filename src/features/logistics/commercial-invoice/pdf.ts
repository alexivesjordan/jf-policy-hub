import { access, readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import sharp from "sharp";
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

function roundBox(page: PDFPage, x: number, y: number, w: number, h: number) {
  const r = 4;
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
  page.drawSvgPath(path, { x, y, borderColor: line, borderWidth: 0.6 });
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
  const logoPng = await sharp(await readFile(path.join(process.cwd(), "public/brand/jordan-fitness.svg"))).png().toBuffer();
  const logo = await pdf.embedPng(logoPng);
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
    page.drawText(value, { x, y, size, font, color, maxWidth });
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
    roundBox(page, MARGIN, y - 22, CONTENT_W, 26);
    let x = MARGIN + 3;
    for (const column of COLS) {
      const lines = wrap(column.label, bold, 6.5, column.w - 4);
      lines.forEach((part, index) => text(page, part, x, y - index * 8, 6.5, bold));
      x += column.w;
    }
    return y - 28;
  };

  const drawRows = (page: PDFPage, y: number, from: number, to: number) => {
    for (let index = from; index < to; index += 1) {
      const row = rows[index]!;
      let x = MARGIN + 3;
      const top = y - 9;
      text(page, row.line.sku, x, top, 7, regular, ink, COLS[0].w - 4);
      row.description.forEach((part, lineNo) => text(page, part, x + COLS[0].w, top - lineNo * 9, 7, regular, ink, COLS[1].w - 4));
      const values = [
        row.line.orderNumber,
        normaliseHsCode(row.line.hsCode) ?? row.line.hsCode,
        money(chargedLinePence(row.line)),
        money(0),
        kilos(lineWeightKg(row.line)),
        row.line.shippedQuantity.toFixed(2),
      ];
      let cursor = x + COLS[0].w + COLS[1].w;
      values.forEach((value, valueIndex) => {
        text(page, value, cursor, top, 7, regular, ink, COLS[valueIndex + 2].w - 3);
        cursor += COLS[valueIndex + 2].w;
      });
      row.origin.forEach((part, lineNo) => text(page, part, cursor, top - lineNo * 9, 7, regular, ink, COLS[8].w - 4));
      const price = "Item Price: " + money(row.line.shippedQuantity > 0 ? Math.round(chargedLinePence(row.line) / row.line.shippedQuantity) : 0);
      text(page, price, A4[0] - MARGIN - regular.widthOfTextAtSize(price, 6.5) - 4, y - row.height + 4, 6.5, regular, grey);
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
    page.drawImage(logo, { x: A4[0] - MARGIN - 150, y: y - 18, width: 150, height: 28 });
    const boxTop = y - 128;
    const boxH = 108;
    const gap = 8;
    const rightW = 168;
    const leftW = (CONTENT_W - rightW - gap * 2) / 2;
    const boxes: [number, number, string, string[]][] = [
      [MARGIN, leftW, "Customer Name & Address", [
        draft.buyer.name,
        ...draft.buyer.address.split(/\n|, /).map((part) => part.trim()).filter(Boolean),
        draft.buyer.vat ? "VAT No: " + draft.buyer.vat : "VAT No:",
        draft.buyer.eori ? "EORI No: " + draft.buyer.eori : "",
      ].filter(Boolean)],
      [MARGIN + leftW + gap, leftW, "Delivery Address", [
        shipment.fao ? "FAO " + shipment.fao : "",
        ...shipment.deliveryAddress.split(/\n|, /).map((part) => part.trim()).filter(Boolean),
      ].filter(Boolean)],
    ];
    for (const [x, w, title, body] of boxes) {
      roundBox(page, x, boxTop - boxH, w, boxH);
      text(page, title, x + 6, boxTop - 14, 8, bold);
      body.slice(0, 8).forEach((part, index) => text(page, part, x + 6, boxTop - 28 - index * 9, 7.5, regular, ink, w - 12));
    }
    const rx = A4[0] - MARGIN - rightW;
    roundBox(page, rx, boxTop - boxH, rightW, boxH);
    text(page, "COMMERCIAL INVOICE", rx + 8, boxTop - 14, 8, bold);
    const meta: [string, string][] = [
      ["FAO:", shipment.fao],
      ["Courier:", shipment.courier],
      ["Despatch Date:", dmy(shipment.despatchDate)],
    ];
    meta.forEach(([label, value], index) => {
      text(page, label, rx + 8, boxTop - 32 - index * 14, 8, bold);
      text(page, value, rx + 78, boxTop - 32 - index * 14, 8, regular, ink, rightW - 86);
    });
    page.drawLine({ start: { x: rx, y: boxTop - 78 }, end: { x: rx + rightW, y: boxTop - 78 }, thickness: 0.6, color: line });
    text(page, "Invoice No:", rx + 8, boxTop - 94, 8, bold);
    text(page, preview ? "PREVIEW" : draft.reference, rx + 70, boxTop - 94, 8, regular);
    return boxTop - boxH - 16;
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
    const boxH = 108;
    const boxY = Math.max(BOTTOM + 8, cursor - boxH);
    const instructions = [
      "Country of origin: " + origins,
      "Country of export: United Kingdom",
      "Incoterms: " + draft.incoterm,
      shipment.contactName ? "Contact: " + shipment.contactName : "Contact:",
      shipment.contactEmail ? "Email: " + shipment.contactEmail : "Email:",
      shipment.specialInstructions,
    ].filter(Boolean);
    const blocks: [string, string[]][] = [
      ["Special Instructions", instructions],
      ["", [
        "No. of parcels:  " + shipment.parcels.toFixed(2),
        "No. of pallets:  " + shipment.pallets.toFixed(2),
        "Total net weight:  " + kilos(shippedLines(draft).reduce((sum, row) => sum + lineWeightKg(row), 0)),
        "Total gross weight:  " + kilos(draft.grossWeightKg),
      ]],
      ["", [
        "Goods Net:  " + money(goods),
        "Delivery:  " + money(shipment.deliveryPence),
        "Surcharge:  " + money(shipment.surchargePence),
        "Net:  " + money(net),
        "VAT:  " + money(shipment.vatPence),
        "Total:  " + money(total),
        currencyName(draft.currency),
      ]],
    ];
    blocks.forEach(([title, body], index) => {
      const x = MARGIN + index * (boxW + 8);
      roundBox(page, x, boxY, boxW, boxH);
      let lineY = boxY + boxH - 14;
      if (title) {
        text(page, title, x + 6, lineY, 8, bold);
        lineY -= 14;
      }
      body.forEach((part) => {
        for (const wrapped of wrap(part, regular, 7.5, boxW - 12)) {
          const font = part.startsWith("Total:") ? bold : regular;
          text(page, wrapped, x + 6, lineY, 7.5, font, ink, boxW - 12);
          lineY -= 11;
        }
      });
    });
    const signY = boxY - 62;
    text(page, "Signed:", MARGIN, signY + 36, 8, regular);
    if (signature) page.drawImage(signature, { x: MARGIN + 42, y: signY + 28, width: 90, height: 28 });
    text(page, "Name:", MARGIN, signY + 18, 8, regular);
    text(page, "Position:", MARGIN + 180, signY + 18, 8, regular);
    text(page, "Date:", MARGIN, signY, 8, regular);
    roundBox(page, A4[0] - MARGIN - 120, signY - 4, 120, 52);
    text(page, "Company stamp", A4[0] - MARGIN - 112, signY + 32, 7, regular, grey);
    if (stamp) page.drawImage(stamp, { x: A4[0] - MARGIN - 112, y: signY, width: 100, height: 40 });
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
    y = tableHeader(page, y);
    y = drawRows(page, y, item.from, item.to);
    if (item.summary) summary(page, y - 8);
    footer(page, index);
  });
  return pdf.save();
}
