import { access, readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { degrees, PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { originSummary } from "./origin";
import { palletLineText, palletTotalText } from "./pallets";
import { COMMERCIAL_INVOICE_MARKS, COMMERCIAL_INVOICE_SELLER, resolveCustomsStatement } from "./seller";
import {
  chargedLinePence, countryName, lineWeightKg, normaliseHsCode, shippedLines, validateCommercialInvoice,
  type GoodsLine, type InvoiceDraft, type InvoiceShipment,
} from "./rules";

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 28;
const FOOTER = 42;
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
export type SummaryPiece =
  | { kind: "dims"; from: number; to: number }
  | { kind: "statement"; from: number; to: number }
  | { kind: "closing" };
export type InvoicePagePlan = {
  role: InvoicePageRole;
  from: number;
  to: number;
  summary: boolean;
  pieces: SummaryPiece[];
  anchor: "top" | "bottom";
  used: number;
};

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
    palletLines: [],
    deliveryPence: Math.round((draft.freightValue || 0) * 100),
    surchargePence: Math.round((draft.otherChargesValue || 0) * 100),
    vatPence: 0,
    customsStatementId: draft.approvedStatement ? "custom" : "none",
    customsStatementText: draft.approvedStatement,
    issuedAt: new Date().toISOString(),
  };
  return { ...base, ...draft.shipment, palletLines: draft.shipment?.palletLines ?? base.palletLines };
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
  return lines;
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

const HEADER_BLOCK = 8 + 2 * 8 + 4;
/** Footer text plus a gap, so the last item-price line stays clear of it. */
const ROW_BOTTOM = FOOTER + 12;

function addressBoxHeight(draft: InvoiceDraft) {
  const shipment = shipmentOf(draft);
  const customer = [
    draft.buyer.name,
    ...draft.buyer.address.split(/\n|, /).map((part) => part.trim()).filter(Boolean),
    draft.buyer.vat ? "vat" : "",
    draft.buyer.eori ? "eori" : "",
  ].filter(Boolean).length;
  const delivery = [
    shipment.fao ? "fao" : "",
    ...shipment.deliveryAddress.split(/\n|, /).map((part) => part.trim()).filter(Boolean),
  ].filter(Boolean).length;
  return Math.max(118, 30 + Math.max(customer, delivery) * 10);
}

function rowsTopFirst(draft: InvoiceDraft) {
  const boxTop = A4[1] - 36 - 132;
  return boxTop - addressBoxHeight(draft) - 14 - HEADER_BLOCK;
}

function rowsTopContinuation() {
  return A4[1] - 28 - 16 - HEADER_BLOCK;
}

const DIM_LINE = 11;
const DIM_HEADER = 14;
const DIM_TAIL = 6;
const STATEMENT_LINE = 12;
const STATEMENT_TAIL = 8;
const INSTR_LINE = 9;
const SIGN_H = 78;
const SUMMARY_GAP = 12;

type SummaryMetrics = {
  columns: number;
  dimRows: number;
  statementLines: string[];
  instructionLines: string[];
  boxH: number;
  signH: number;
  gap: number;
  total: number;
};

function instructionParts(shipment: InvoiceShipment) {
  const note = shipment.specialInstructions.trim();
  return note ? [note] : [];
}

function signBlockHeight(origin: string, font: PDFFont) {
  const width = (CONTENT_W - 150 - 8) / 2 - 16;
  const originLines = Math.max(1, wrap(origin || "—", font, 7.5, width).length);
  return Math.max(SIGN_H, 16 + (originLines + 2) * 12 + 10);
}

function measureSummary(draft: InvoiceDraft, font: PDFFont): SummaryMetrics {
  const shipment = shipmentOf(draft);
  const statement = resolveCustomsStatement(shipment.customsStatementId, shipment.customsStatementText) || shipment.customsStatementText;
  const statementLines = statement
    ? statement.split("\n").flatMap((part) => {
      const wrapped = wrap(part, font, 8, CONTENT_W);
      return wrapped.length ? wrapped : [""];
    })
    : [];
  const boxW = (CONTENT_W - 16) / 3;
  const parts = instructionParts(shipment);
  const instructionLines = parts.flatMap((part) => wrap(part, font, 7.5, boxW - 16));
  const boxH = instructionLines.length ? boxesHeight(0, instructionLines.length) : Math.max(108, 16 + 4 * 14 + 12, 16 + 6 * 13 + 22);
  const columns = 1;
  const dimRows = shipment.palletLines.length ? shipment.palletLines.length + 1 : 0;
  const signH = signBlockHeight(originSummary(shippedLines(draft)), font);
  const dimsH = dimRows ? DIM_HEADER + dimRows * DIM_LINE + DIM_TAIL : 0;
  const statementH = statementLines.length ? statementLines.length * STATEMENT_LINE + STATEMENT_TAIL : 0;
  return {
    columns, dimRows, statementLines, instructionLines, boxH, signH, gap: SUMMARY_GAP,
    total: dimsH + statementH + boxH + SUMMARY_GAP + signH,
  };
}

function boxesHeight(from: number, to: number) {
  const lines = Math.max(0, to - from);
  return Math.max(108, 30 + lines * INSTR_LINE + 12, 16 + 4 * 14 + 12, 16 + 6 * 13 + 22);
}

function pieceHeight(piece: SummaryPiece, metrics: SummaryMetrics) {
  if (piece.kind === "dims") {
    const header = piece.from === 0 ? DIM_HEADER : 0;
    const tail = piece.to === metrics.dimRows ? DIM_TAIL : 0;
    return header + (piece.to - piece.from) * DIM_LINE + tail;
  }
  if (piece.kind === "statement") {
    const tail = piece.to === metrics.statementLines.length ? STATEMENT_TAIL : 0;
    return (piece.to - piece.from) * STATEMENT_LINE + tail;
  }
  return metrics.boxH + SUMMARY_GAP + metrics.signH;
}

function closingHeight(metrics: SummaryMetrics) {
  return metrics.boxH + SUMMARY_GAP + metrics.signH;
}

/** Lines at the end of the statement that must share a page with the totals and signature. */
function statementTailLines(metrics: SummaryMetrics, pageRoom: number) {
  if (!metrics.statementLines.length) return 0;
  const available = pageRoom - closingHeight(metrics);
  let lines = 0;
  for (let next = 1; next <= metrics.statementLines.length; next += 1) {
    if (next * STATEMENT_LINE + STATEMENT_TAIL > available) break;
    lines = next;
  }
  return lines > 0 ? lines : 1;
}

function layoutPieces(metrics: SummaryMetrics, pageRoom: number): SummaryPiece[] {
  const pieces: SummaryPiece[] = [];
  const whole = metrics.total <= pageRoom;
  const tail = whole ? metrics.statementLines.length : statementTailLines(metrics, pageRoom);
  if (metrics.dimRows) pieces.push({ kind: "dims", from: 0, to: metrics.dimRows });
  const headEnd = metrics.statementLines.length - tail;
  if (headEnd > 0) pieces.push({ kind: "statement", from: 0, to: headEnd });
  if (tail > 0) pieces.push({ kind: "statement", from: headEnd, to: metrics.statementLines.length });
  pieces.push({ kind: "closing" });
  return pieces;
}

function takePiece(piece: SummaryPiece, room: number, metrics: SummaryMetrics): { fit: SummaryPiece | null; rest: SummaryPiece | null; height: number } {
  const whole = pieceHeight(piece, metrics);
  if (whole <= room) return { fit: piece, rest: null, height: whole };
  if (piece.kind === "closing") return { fit: null, rest: piece, height: 0 };
  if (piece.kind === "dims") {
    const header = piece.from === 0 ? DIM_HEADER : 0;
    let rows = Math.floor((room - header) / DIM_LINE);
    if (piece.from + rows >= piece.to && whole > room) rows = piece.to - piece.from - 1;
    if (rows < 1) return { fit: null, rest: piece, height: 0 };
    const fit: SummaryPiece = { kind: "dims", from: piece.from, to: piece.from + rows };
    return { fit, rest: { kind: "dims", from: fit.to, to: piece.to }, height: pieceHeight(fit, metrics) };
  }
  let lines = Math.floor((room - (piece.to === metrics.statementLines.length ? STATEMENT_TAIL : 0)) / STATEMENT_LINE);
  if (piece.from + lines >= piece.to && whole > room) lines = piece.to - piece.from - 1;
  if (lines < 1) return { fit: null, rest: piece, height: 0 };
  const fit: SummaryPiece = { kind: "statement", from: piece.from, to: piece.from + lines };
  return { fit, rest: { kind: "statement", from: fit.to, to: piece.to }, height: pieceHeight(fit, metrics) };
}

function gluedTail(piece: SummaryPiece, next: SummaryPiece | undefined, metrics: SummaryMetrics) {
  return piece.kind === "statement" && piece.to === metrics.statementLines.length && next?.kind === "closing";
}

function packPieces(pieces: SummaryPiece[], room: number, metrics: SummaryMetrics) {
  const placed: SummaryPiece[] = [];
  let used = 0;
  let index = 0;
  while (index < pieces.length) {
    const piece = pieces[index]!;
    const next = pieces[index + 1];
    if (gluedTail(piece, next, metrics)) {
      const height = pieceHeight(piece, metrics) + pieceHeight(next!, metrics);
      if (used + height > room) break;
      placed.push(piece, next!);
      used += height;
      index += 2;
      continue;
    }
    const taken = takePiece(piece, room - used, metrics);
    if (!taken.fit) break;
    placed.push(taken.fit);
    used += taken.height;
    if (taken.rest) return { placed, rest: [taken.rest, ...pieces.slice(index + 1)], height: used };
    index += 1;
  }
  return { placed, rest: pieces.slice(index), height: used };
}

function summaryAnchor(pieces: SummaryPiece[], metrics: SummaryMetrics): "top" | "bottom" {
  if (!pieces.some((piece) => piece.kind === "closing")) return "top";
  const dims = pieces.find((piece) => piece.kind === "dims");
  const statement = pieces.find((piece) => piece.kind === "statement");
  const dimsPartial = dims?.kind === "dims" && (dims.from !== 0 || dims.to !== metrics.dimRows);
  const statementPartial = statement?.kind === "statement" && (statement.from !== 0 || statement.to !== metrics.statementLines.length);
  return dimsPartial || statementPartial ? "top" : "bottom";
}

function pageOf(role: InvoicePageRole, from: number, to: number, pieces: SummaryPiece[], anchor: "top" | "bottom", used: number): InvoicePagePlan {
  return { role, from, to, summary: pieces.length > 0, pieces, anchor, used };
}

function rowsHeight(rows: Measured[], from: number, to: number) {
  let used = 0;
  for (let index = from; index < to; index += 1) used += rows[index]!.height;
  return used;
}

export function commercialInvoicePageRoom(draft: InvoiceDraft, role: InvoicePageRole) {
  return (role === "first" ? rowsTopFirst(draft) : rowsTopContinuation()) - ROW_BOTTOM;
}

export function planCommercialInvoice(draft: InvoiceDraft, font: PDFFont): InvoicePagePlan[] {
  const rows = measure(shippedLines(draft), font);
  const metrics = measureSummary(draft, font);
  const firstRoom = commercialInvoicePageRoom(draft, "first");
  const contRoom = commercialInvoicePageRoom(draft, "continuation");
  const pieces = layoutPieces(metrics, contRoom);
  const reserve = metrics.total <= contRoom ? metrics.total : 0;
  const built: InvoicePagePlan[] = [];

  const addSummaryPages = (pending: SummaryPiece[]) => {
    let rest = pending;
    while (rest.length) {
      const packed = packPieces(rest, contRoom, metrics);
      let placed = packed.placed;
      let next = packed.rest;
      if (!placed.length) {
        const pair = gluedTail(rest[0]!, rest[1], metrics);
        placed = pair ? [rest[0]!, rest[1]!] : [rest[0]!];
        next = rest.slice(placed.length);
      }
      const height = placed.reduce((sum, piece) => sum + pieceHeight(piece, metrics), 0);
      built.push(pageOf("continuation", rows.length, rows.length, placed, summaryAnchor(placed, metrics), height));
      rest = next;
    }
  };

  const attachOrMove = (leftover: number) => {
    if (metrics.total <= contRoom) {
      if (leftover >= metrics.total) {
        const last = built[built.length - 1]!;
        last.pieces = pieces;
        last.summary = true;
        last.anchor = "bottom";
        last.used += metrics.total;
      } else addSummaryPages(pieces);
      return;
    }
    const packed = packPieces(pieces, leftover, metrics);
    if (packed.placed.length) {
      const last = built[built.length - 1]!;
      last.pieces = packed.placed;
      last.summary = true;
      last.anchor = summaryAnchor(packed.placed, metrics);
      last.used += packed.height;
      addSummaryPages(packed.rest);
    } else addSummaryPages(pieces);
  };

  if (!rows.length) {
    addSummaryPages(pieces);
  } else if (metrics.total <= firstRoom && fits(rows, 0, rows.length, firstRoom - metrics.total)) {
    built.push(pageOf("first", 0, rows.length, pieces, "bottom", rowsHeight(rows, 0, rows.length) + metrics.total));
  } else {
    let cursor = take(rows, 0, firstRoom);
    built.push(pageOf("first", 0, cursor, [], "top", rowsHeight(rows, 0, cursor)));
    while (cursor < rows.length) {
      if (reserve > 0 && fits(rows, cursor, rows.length, contRoom - reserve)) {
        built.push(pageOf("continuation", cursor, rows.length, pieces, "bottom", rowsHeight(rows, cursor, rows.length) + metrics.total));
        cursor = rows.length;
        break;
      }
      const end = take(rows, cursor, contRoom);
      built.push(pageOf("continuation", cursor, end, [], "top", rowsHeight(rows, cursor, end)));
      cursor = end;
    }
    if (!built.some((page) => page.summary)) {
      const last = built[built.length - 1]!;
      const room = last.role === "first" ? firstRoom : contRoom;
      attachOrMove(room - last.used);
    }
  }

  return built.map((page, index) => ({
    ...page,
    role: index === 0 ? "first" : index === built.length - 1 ? "last" : "continuation",
  }));
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
  const goods = shippedLines(draft).reduce((sum, row) => sum + chargedLinePence(row), 0);
  const net = goods + shipment.deliveryPence + shipment.surchargePence;
  const total = net + shipment.vatPence;
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
      const x = MARGIN + 3;
      const top = y - 9;
      text(page, row.line.sku, x, top, 7, regular, ink, COLS[0].w - 4);
      row.description.forEach((part, lineNo) => text(page, part, x + COLS[0].w, top - lineNo * 9, 7, regular, ink, COLS[1].w - 4));
      const numeric: [string, "left" | "right" | "center"][] = [
        [row.line.orderNumber, "right"],
        [normaliseHsCode(row.line.hsCode) ?? row.line.hsCode, "right"],
        [money(chargedLinePence(row.line)), "right"],
        [shipment.vatPence > 0 ? "-" : money(0), "right"],
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
    const y = A4[1] - 36;
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

  const metrics = measureSummary(draft, regular);
  const boxW = (CONTENT_W - 16) / 3;
  const drawSummary = (page: PDFPage, ceiling: number, item: InvoicePagePlan) => {
    const blockHeight = item.pieces.reduce((sum, piece) => sum + pieceHeight(piece, metrics), 0);
    let cursor = item.anchor === "bottom" ? Math.min(ceiling, ROW_BOTTOM + blockHeight) : ceiling;
    const drawDims = (piece: Extract<SummaryPiece, { kind: "dims" }>) => {
      if (piece.from === 0) {
        text(page, "Dimensions:", MARGIN, cursor - 11, 9, bold);
        cursor -= DIM_HEADER;
      }
      for (let row = piece.from; row < piece.to; row += 1) {
        const label = row < shipment.palletLines.length
          ? palletLineText(row, shipment.palletLines[row]!)
          : palletTotalText(shipment.palletLines);
        text(page, label, MARGIN, cursor - 9, 8, regular);
        cursor -= DIM_LINE;
      }
      if (piece.to === metrics.dimRows) cursor -= DIM_TAIL;
    };
    const drawStatement = (piece: Extract<SummaryPiece, { kind: "statement" }>) => {
      for (let index = piece.from; index < piece.to; index += 1) {
        text(page, metrics.statementLines[index] ?? "", MARGIN, cursor - 10, 8, regular);
        cursor -= STATEMENT_LINE;
      }
      if (piece.to === metrics.statementLines.length) cursor -= STATEMENT_TAIL;
    };
    const drawClosing = () => {
      const boxTop = cursor;
      const boxH = metrics.boxH;
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
      const labelValue = (x: number, rowY: number, label: string, value: string, strong = false) => {
        text(page, label, x + 8, rowY, 7.5, strong ? bold : regular);
        aligned(page, value, x, rowY, boxW, 7.5, strong ? bold : regular, "right");
      };
      if (metrics.instructionLines.length) {
        roundBox(page, MARGIN, boxTop, boxW, boxH);
        text(page, "Special Instructions", MARGIN + 8, boxTop - 16, 8, bold);
        let lineY = boxTop - 30;
        for (const wrapped of metrics.instructionLines) {
          text(page, wrapped, MARGIN + 8, lineY, 7.5, regular);
          lineY -= INSTR_LINE;
        }
      }
      const midX = MARGIN + boxW + 8;
      roundBox(page, midX, boxTop, boxW, boxH);
      middle.forEach(([label, value], index) => labelValue(midX, boxTop - 18 - index * 16, label, value));
      const rightX = MARGIN + (boxW + 8) * 2;
      roundBox(page, rightX, boxTop, boxW, boxH);
      totals.forEach(([label, value, strong], index) => labelValue(rightX, boxTop - 16 - index * 13, label, value, strong));
      const currency = currencyName(draft.currency);
      text(page, currency, rightX + (boxW - regular.widthOfTextAtSize(currency, 7.5)) / 2, boxTop - boxH + 10, 7.5, regular);
      cursor -= boxH + SUMMARY_GAP;
      const signTop = cursor;
      const stampW = 150;
      const signW = CONTENT_W - stampW - 8;
      roundBox(page, MARGIN, signTop, signW, metrics.signH);
      const underline = (label: string, x: number, rowY: number, width: number) => {
        text(page, label, x, rowY, 8, regular);
        const start = x + regular.widthOfTextAtSize(label, 8) + 6;
        page.drawLine({ start: { x: start, y: rowY - 1 }, end: { x: x + width, y: rowY - 1 }, thickness: 0.4, color: line });
      };
      underline("Signed:", MARGIN + 8, signTop - 18, signW / 2 - 16);
      if (signature) page.drawImage(signature, { x: MARGIN + 58, y: signTop - 28, width: 80, height: 22 });
      underline("Name:", MARGIN + 8, signTop - 40, signW / 2 - 20);
      underline("Date:", MARGIN + 8, signTop - 62, signW / 2 - 20);
      const origin = originSummary(shippedLines(draft));
      const termsX = MARGIN + signW / 2;
      const termsW = signW / 2 - 12;
      const originLines = wrap(origin || "—", regular, 7.5, termsW);
      text(page, "Country of Origin:", termsX, signTop - 16, 7.5, bold);
      originLines.forEach((line, index) => text(page, line, termsX, signTop - 28 - index * 10, 7.5, regular));
      const termsY = signTop - 28 - originLines.length * 10 - 6;
      text(page, "Country of Export: United Kingdom", termsX, termsY, 7.5, regular);
      text(page, "Incoterms: " + draft.incoterm, termsX, termsY - 12, 7.5, regular);
      roundBox(page, MARGIN + signW + 8, signTop, stampW, metrics.signH);
      text(page, "Company stamp", MARGIN + signW + 16, signTop - 16, 8, regular, grey);
      if (stamp) page.drawImage(stamp, { x: MARGIN + signW + 20, y: signTop - metrics.signH + 10, width: stampW - 24, height: 40 });
      cursor -= metrics.signH;
    };
    item.pieces.forEach((piece) => {
      if (piece.kind === "dims") drawDims(piece);
      else if (piece.kind === "statement") drawStatement(piece);
      else drawClosing();
    });
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
    if (item.pieces.length) drawSummary(page, y, item);
    footer(page, index);
  });
  return pdf.save();
}
