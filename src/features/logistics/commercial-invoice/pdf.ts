import { access, readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { degrees, PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { originSummary } from "./origin";
import { dimensionCounts, dimensionLabel, dimensionSummary, palletGrossKg } from "./pallets";
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
  | { kind: "notes"; from: number; to: number }
  | { kind: "dims"; from: number; to: number }
  | { kind: "boxes" }
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

function money(pence: number) {
  return new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(pence / 100);
}

function kilos(kg: number) {
  return kg.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " Kg";
}

function onePlaceKg(kg: number) {
  return kg.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " kg";
}

function dmy(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

function londonDay(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return get("day") + "/" + get("month") + "/" + get("year");
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

const BODY = 8.5;
const LEAD = 12;
const STRIP = 16;
const PAD = 8;
const GAP = 6;
const DECLARATION_H = 136;
const PANEL_BORDER = rgb(0.62, 0.62, 0.62);
const PANEL_FILL = rgb(0.94, 0.94, 0.94);

type SummaryMetrics = {
  dimRows: number;
  noteLines: string[];
  statementLines: string[];
  exportRows: string[][];
  trioH: number;
  total: number;
};

function boxedLines(text: string, font: PDFFont, width: number) {
  const source = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!source) return [];
  const lines: string[] = [];
  for (const part of source.split("\n")) {
    if (!part.trim()) {
      lines.push("");
      continue;
    }
    const wrapped = wrap(part, font, BODY, width);
    lines.push(...(wrapped.length ? wrapped : [""]));
  }
  return lines;
}

function linesBox(count: number) {
  return STRIP + count * LEAD + 10;
}

function dimLayout(count: number, includesTotal: boolean) {
  const data = includesTotal ? Math.max(0, count - 1) : count;
  const two = data > 6;
  const body = (two ? Math.ceil(data / 2) : data) + (includesTotal ? 1 : 0);
  return { data, two, body, headers: two ? 2 : 1 };
}

function dimsHeight(count: number, includesTotal = false) {
  const layout = dimLayout(count, includesTotal);
  return STRIP + 8 + layout.headers * LEAD + layout.body * LEAD + 8;
}

function measureSummary(draft: InvoiceDraft, font: PDFFont): SummaryMetrics {
  const shipment = shipmentOf(draft);
  const inner = CONTENT_W - PAD * 2;
  const note = shipment.specialInstructions.trim();
  const noteLines = note ? boxedLines(note, font, inner) : [];
  const statement = resolveCustomsStatement(shipment.customsStatementId, shipment.customsStatementText) || shipment.customsStatementText;
  const statementLines = boxedLines(statement, font, inner);
  const boxW = (CONTENT_W - GAP * 2) / 3;
  const valueWidth = exportValueWidth(boxW, font);
  const incoterms = draft.incoterm.trim();
  const exportRows = [originSummary(shippedLines(draft)) || "—", "United Kingdom", incoterms]
    .map((value) => {
      const lines = wrap(value, font, BODY, valueWidth);
      return lines.length ? lines : ["—"];
    });
  const trioLines = Math.max(4, exportRows.reduce((count, lines) => count + lines.length, 0), 6);
  const trioH = linesBox(trioLines);
  const dimRows = shipment.palletLines.length ? shipment.palletLines.length + 1 : 0;
  const notesH = noteLines.length ? linesBox(noteLines.length) + GAP : 0;
  const dimsH = dimRows ? dimsHeight(dimRows, true) + GAP : 0;
  const statementH = statementLines.length ? linesBox(statementLines.length) + GAP : 0;
  return {
    dimRows,
    noteLines,
    statementLines,
    exportRows,
    trioH,
    total: notesH + dimsH + trioH + GAP + statementH + DECLARATION_H,
  };
}

function exportLabels() {
  return ["Country of origin", "Country of export", "Incoterms"];
}

function exportValueWidth(boxW: number, font: PDFFont) {
  const labelW = Math.max(...exportLabels().map((label) => font.widthOfTextAtSize(label, BODY)));
  return Math.max(36, boxW - PAD - labelW - 8 - PAD);
}

export function commercialInvoiceTrio(draft: InvoiceDraft, font: PDFFont) {
  const metrics = measureSummary(draft, font);
  const width = (CONTENT_W - GAP * 2) / 3;
  return [0, 1, 2].map((index) => ({
    x: MARGIN + index * (width + GAP),
    w: width,
    h: metrics.trioH,
  }));
}

function pieceHeight(piece: SummaryPiece, metrics: SummaryMetrics) {
  if (piece.kind === "notes") return linesBox(piece.to - piece.from) + GAP;
  if (piece.kind === "dims") return dimsHeight(piece.to - piece.from, piece.to === metrics.dimRows) + GAP;
  if (piece.kind === "boxes") return metrics.trioH + GAP;
  if (piece.kind === "statement") return linesBox(piece.to - piece.from) + GAP;
  return DECLARATION_H;
}

function closingRunHeight(metrics: SummaryMetrics, statementLines: number) {
  return metrics.trioH + GAP + (statementLines ? linesBox(statementLines) + GAP : 0) + DECLARATION_H;
}

/** Statement lines that must share the last page with the three boxes and the declaration. */
function statementTailLines(metrics: SummaryMetrics, pageRoom: number) {
  if (!metrics.statementLines.length) return 0;
  let lines = 0;
  for (let next = 1; next <= metrics.statementLines.length; next += 1) {
    if (closingRunHeight(metrics, next) > pageRoom) break;
    lines = next;
  }
  return lines > 0 ? lines : 1;
}

function layoutPieces(metrics: SummaryMetrics, pageRoom: number): SummaryPiece[] {
  const pieces: SummaryPiece[] = [];
  const whole = metrics.total <= pageRoom;
  const tail = whole ? metrics.statementLines.length : statementTailLines(metrics, pageRoom);
  if (metrics.noteLines.length) pieces.push({ kind: "notes", from: 0, to: metrics.noteLines.length });
  if (metrics.dimRows) pieces.push({ kind: "dims", from: 0, to: metrics.dimRows });
  const headEnd = metrics.statementLines.length - tail;
  if (headEnd > 0) pieces.push({ kind: "statement", from: 0, to: headEnd });
  pieces.push({ kind: "boxes" });
  if (tail > 0) pieces.push({ kind: "statement", from: headEnd, to: metrics.statementLines.length });
  pieces.push({ kind: "closing" });
  return pieces;
}

function takePiece(piece: SummaryPiece, room: number, metrics: SummaryMetrics): { fit: SummaryPiece | null; rest: SummaryPiece | null; height: number } {
  const whole = pieceHeight(piece, metrics);
  if (whole <= room) return { fit: piece, rest: null, height: whole };
  if (piece.kind === "closing" || piece.kind === "boxes") return { fit: null, rest: piece, height: 0 };
  const limit = piece.kind === "dims" ? metrics.dimRows : piece.kind === "notes" ? metrics.noteLines.length : metrics.statementLines.length;
  let count = piece.to - piece.from;
  while (count > 0) {
    const end = piece.from + count;
    const leavesTotalAlone = piece.kind === "dims" && piece.to === metrics.dimRows && end === metrics.dimRows - 1;
    const candidate = { ...piece, to: end } as SummaryPiece;
    if (!leavesTotalAlone && pieceHeight(candidate, metrics) <= room) break;
    count -= 1;
  }
  if (count < 1 || piece.from + count > limit) return { fit: null, rest: piece, height: 0 };
  if (piece.from + count >= piece.to) return { fit: piece, rest: null, height: whole };
  const end = piece.from + count;
  const fit = { ...piece, to: end };
  const rest = { ...piece, from: end };
  return { fit, rest, height: pieceHeight(fit, metrics) };
}

function closingRun(pieces: SummaryPiece[], index: number, metrics: SummaryMetrics): SummaryPiece[] | null {
  if (pieces[index]?.kind !== "boxes") return null;
  const run: SummaryPiece[] = [pieces[index]!];
  let cursor = index + 1;
  const next = pieces[cursor];
  if (next?.kind === "statement" && next.to === metrics.statementLines.length) {
    run.push(next);
    cursor += 1;
  }
  if (pieces[cursor]?.kind !== "closing") return null;
  run.push(pieces[cursor]!);
  return run;
}

function packPieces(pieces: SummaryPiece[], room: number, metrics: SummaryMetrics) {
  const placed: SummaryPiece[] = [];
  let used = 0;
  let index = 0;
  while (index < pieces.length) {
    const run = closingRun(pieces, index, metrics);
    if (run) {
      const height = run.reduce((sum, piece) => sum + pieceHeight(piece, metrics), 0);
      if (used + height > room) break;
      placed.push(...run);
      used += height;
      index += run.length;
      continue;
    }
    const taken = takePiece(pieces[index]!, room - used, metrics);
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
  const partial = pieces.some((piece) => {
    if (piece.kind === "dims") return piece.from !== 0 || piece.to !== metrics.dimRows;
    if (piece.kind === "statement") return piece.from !== 0 || piece.to !== metrics.statementLines.length;
    if (piece.kind === "notes") return piece.from !== 0 || piece.to !== metrics.noteLines.length;
    return false;
  });
  return partial ? "top" : "bottom";
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
        const run = closingRun(rest, 0, metrics);
        placed = run ?? [rest[0]!];
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
  const printedName = await optionalImage(pdf, COMMERCIAL_INVOICE_MARKS.printedNameFile);
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
    const printed = "Printed:  " + printedStamp(new Date().toISOString());
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
  const trio = commercialInvoiceTrio(draft, regular);
  const drawSummary = (page: PDFPage, ceiling: number, item: InvoicePagePlan) => {
    const blockHeight = item.pieces.reduce((sum, piece) => sum + pieceHeight(piece, metrics), 0);
    let cursor = item.anchor === "bottom" ? Math.min(ceiling, ROW_BOTTOM + blockHeight) : ceiling;
    const panel = (x: number, top: number, w: number, h: number, title: string) => {
      const r = Math.min(4, h / 2, w / 2);
      const strip = Math.min(STRIP, h - 1);
      const header = [
        `M ${r} 0`, `L ${w - r} 0`, `Q ${w} 0 ${w} ${r}`, `L ${w} ${strip}`, `L 0 ${strip}`, `L 0 ${r}`, `Q 0 0 ${r} 0`, "Z",
      ].join(" ");
      const border = [
        `M ${r} 0`, `L ${w - r} 0`, `Q ${w} 0 ${w} ${r}`, `L ${w} ${h - r}`, `Q ${w} ${h} ${w - r} ${h}`,
        `L ${r} ${h}`, `Q 0 ${h} 0 ${h - r}`, `L 0 ${r}`, `Q 0 0 ${r} 0`, "Z",
      ].join(" ");
      page.drawSvgPath(header, { x, y: top, color: PANEL_FILL });
      page.drawSvgPath(border, { x, y: top, borderColor: PANEL_BORDER, borderWidth: 0.75 });
      text(page, title, x + PAD, top - 11, 7.5, bold, ink, w - PAD * 2);
    };
    const rightText = (value: string, x: number, y: number, w: number, font: PDFFont) => {
      text(page, value, x + w - PAD - font.widthOfTextAtSize(value, BODY), y, BODY, font);
    };
    const drawLines = (piece: Extract<SummaryPiece, { kind: "notes" | "statement" }>, lines: string[], title: string) => {
      const boxH = linesBox(piece.to - piece.from);
      const heading = piece.from === 0 ? title : title + " (cont.)";
      panel(MARGIN, cursor, CONTENT_W, boxH, heading);
      let y = cursor - STRIP - LEAD;
      for (let index = piece.from; index < piece.to; index += 1) {
        text(page, lines[index] ?? "", MARGIN + PAD, y, BODY, regular, ink, CONTENT_W - PAD * 2);
        y -= LEAD;
      }
      cursor -= boxH + GAP;
    };
    const drawDims = (piece: Extract<SummaryPiece, { kind: "dims" }>) => {
      const count = piece.to - piece.from;
      const includesTotal = piece.to === metrics.dimRows;
      const layout = dimLayout(count, includesTotal);
      const boxH = dimsHeight(count, includesTotal);
      const two = layout.two;
      panel(MARGIN, cursor, CONTENT_W, boxH, piece.from === 0 ? "DIMENSIONS" : "DIMENSIONS (cont.)");
      const innerGap = 12;
      const tableW = two ? (CONTENT_W - PAD * 2 - innerGap) / 2 : CONTENT_W - PAD * 2;
      const columnW = (width: number) => {
        const labelW = Math.min(two ? 78 : 108, width * (two ? 0.32 : 0.24));
        const weightW = Math.min(72, width * 0.2);
        const rest = (width - labelW - weightW) / 3;
        return [labelW, rest, rest, rest, weightW];
      };
      const headers = two
        ? [["Pallets/", "Parcels"], ["Length", "(cm)"], ["Width", "(cm)"], ["Depth", "(cm)"], ["Weight", "(kg)"]]
        : [["Pallets/Parcels", ""], ["Length (cm)", ""], ["Width (cm)", ""], ["Depth (cm)", ""], ["Weight (kg)", ""]];
      const cellsFor = (row: number) => {
        if (row >= shipment.palletLines.length) {
          return [dimensionSummary(shipment.palletLines), "", "", "", palletGrossKg(shipment.palletLines).toFixed(1)];
        }
        const pallet = shipment.palletLines[row]!;
        return [dimensionLabel(row, pallet), String(pallet.lengthCm), String(pallet.widthCm), String(pallet.depthCm), pallet.weightKg.toFixed(1)];
      };
      const atRight = (value: string, x: number, y: number, w: number, font: PDFFont) => {
        text(page, value, x + w - font.widthOfTextAtSize(value, BODY), y, BODY, font);
      };
      const dataEnd = includesTotal ? piece.to - 1 : piece.to;
      const dataCount = dataEnd - piece.from;
      const leftCount = two ? Math.ceil(dataCount / 2) : dataCount;
      const headerY = cursor - STRIP - LEAD;
      const drawCells = (x: number, y: number, widths: number[], cells: string[], font: PDFFont) => {
        let cellX = x;
        cells.forEach((cell, index) => {
          const colW = widths[index]!;
          if (index === 0) text(page, cell, cellX, y, BODY, font);
          else if (cell) atRight(cell, cellX, y, colW, font);
          cellX += colW;
        });
      };
      for (let set = 0; set < (two ? 2 : 1); set += 1) {
        const x = MARGIN + PAD + set * (tableW + innerGap);
        const widths = columnW(tableW);
        const start = piece.from + set * leftCount;
        const end = Math.min(dataEnd, start + (set === 0 ? leftCount : dataCount - leftCount));
        let colX = x;
        headers.forEach(([main, unit], index) => {
          const colW = widths[index]!;
          if (index === 0) {
            text(page, main, colX, headerY, BODY, regular);
            if (unit) text(page, unit, colX, headerY - LEAD, BODY, regular);
          } else {
            atRight(main, colX, headerY, colW, regular);
            if (unit) atRight(unit, colX, headerY - LEAD, colW, regular);
          }
          colX += colW;
        });
        for (let row = start; row < end; row += 1) {
          drawCells(x, headerY - layout.headers * LEAD - (row - start) * LEAD, widths, cellsFor(row), regular);
        }
        if (!two && includesTotal && set === 0) {
          const y = headerY - layout.headers * LEAD - dataCount * LEAD;
          page.drawLine({ start: { x, y: y + 9 }, end: { x: x + tableW, y: y + 9 }, thickness: 0.4, color: PANEL_BORDER });
          drawCells(x, y, widths, cellsFor(shipment.palletLines.length), bold);
        }
      }
      if (two) {
        const ruleX = MARGIN + PAD + tableW + innerGap / 2;
        const ruleEnd = includesTotal ? cursor - boxH + LEAD + 14 : cursor - boxH + 6;
        page.drawLine({ start: { x: ruleX, y: cursor - STRIP }, end: { x: ruleX, y: ruleEnd }, thickness: 0.4, color: PANEL_BORDER });
        if (includesTotal) {
          const y = headerY - layout.headers * LEAD - Math.ceil(dataCount / 2) * LEAD;
          const full = columnW(CONTENT_W - PAD * 2);
          page.drawLine({ start: { x: MARGIN + PAD, y: y + 9 }, end: { x: MARGIN + CONTENT_W - PAD, y: y + 9 }, thickness: 0.4, color: PANEL_BORDER });
          drawCells(MARGIN + PAD, y, full, cellsFor(shipment.palletLines.length), bold);
        }
      }
      cursor -= boxH + GAP;
    };
    const drawBoxes = () => {
      const top = cursor;
      const explicit = shipment.palletLines.some((row) => row.kind === "parcel" || row.kind === "pallet");
      const counted = explicit ? dimensionCounts(shipment.palletLines) : {
        parcels: Math.max(0, Math.trunc(Number(shipment.parcels) || 0)),
        pallets: shipment.palletLines.length
          ? Math.max(0, Math.trunc(Number(shipment.pallets) || shipment.palletLines.length))
          : Math.max(0, Math.trunc(Number(shipment.pallets) || 0)),
      };
      const rows: [string, string, boolean][][] = [
        [
          ["No. of parcels", String(counted.parcels), false],
          ["No. of pallets", String(counted.pallets), false],
          ["Net weight", onePlaceKg(shippedLines(draft).reduce((sum, row) => sum + lineWeightKg(row), 0)), false],
          ["Gross weight", onePlaceKg(draft.grossWeightKg), false],
        ],
        [],
        [
          ["Goods net", money(goods), false],
          ["Delivery", money(shipment.deliveryPence), false],
          ["Surcharge", money(shipment.surchargePence), false],
          ["Net", money(net), false],
          ["VAT", money(shipment.vatPence), false],
          ["Total", money(total), true],
        ],
      ];
      const titles = ["SHIPMENT", "EXPORT DETAILS", "TOTALS (" + draft.currency + ")"];
      trio.forEach((box, index) => {
        panel(box.x, top, box.w, box.h, titles[index]!);
        if (index === 1) {
          const labels = exportLabels();
          const labelW = Math.max(...labels.map((label) => regular.widthOfTextAtSize(label, BODY)));
          const valueX = box.x + PAD + labelW + 8;
          let y = top - STRIP - LEAD;
          labels.forEach((label, row) => {
            const lines = metrics.exportRows[row] ?? ["—"];
            text(page, label, box.x + PAD, y, BODY, regular);
            lines.forEach((part, lineNo) => text(page, part, valueX, y - lineNo * LEAD, BODY, regular));
            y -= lines.length * LEAD;
          });
          return;
        }
        let y = top - STRIP - LEAD;
        rows[index]!.forEach(([label, value, strong]) => {
          const font = strong ? bold : regular;
          if (strong) page.drawLine({ start: { x: box.x + PAD, y: y + 9 }, end: { x: box.x + box.w - PAD, y: y + 9 }, thickness: 0.4, color: PANEL_BORDER });
          text(page, label, box.x + PAD, y, BODY, font);
          rightText(value, box.x, y, box.w, font);
          y -= LEAD;
        });
      });
      cursor -= metrics.trioH + GAP;
    };
    const drawDeclaration = () => {
      const top = cursor;
      panel(MARGIN, top, CONTENT_W, DECLARATION_H, "DECLARATION");
      const split = MARGIN + CONTENT_W * 2 / 3;
      page.drawLine({ start: { x: split, y: top - STRIP }, end: { x: split, y: top - DECLARATION_H }, thickness: 0.6, color: PANEL_BORDER });
      const labels = ["Signed:", "Name:", "Date:"];
      const labelW = Math.max(...labels.map((label) => regular.widthOfTextAtSize(label, BODY)));
      const lineStart = MARGIN + PAD + labelW + 8;
      const lineEnd = split - PAD;
      const lineSpan = lineEnd - lineStart - 4;
      const fit = (image: { width: number; height: number }, maxW: number, maxH: number) => {
        const scale = Math.min(maxW / image.width, maxH / image.height);
        return { width: image.width * scale, height: image.height * scale };
      };
      const signatureSize = signature ? fit(signature, Math.min(160, lineSpan), 40) : { width: 0, height: 0 };
      const nameSize = printedName ? fit(printedName, Math.min(180, lineSpan), 28) : { width: 0, height: 0 };
      const signedY = top - STRIP - 8 - Math.max(signatureSize.height, 14);
      const nameY = signedY - 8 - Math.max(nameSize.height, 14);
      const dateY = nameY - 22;
      const raised = preview ? londonDay(new Date()) : dmy(draft.issueDate);
      const rows: [string, number][] = [["Signed:", signedY], ["Name:", nameY], ["Date:", dateY]];
      rows.forEach(([label, y]) => {
        text(page, label, MARGIN + PAD, y, BODY, regular);
        page.drawLine({ start: { x: lineStart, y: y - 1 }, end: { x: lineEnd, y: y - 1 }, thickness: 0.4, color: line });
      });
      if (signature) page.drawImage(signature, { x: lineStart, y: signedY - 1, width: signatureSize.width, height: signatureSize.height });
      if (printedName) page.drawImage(printedName, { x: lineStart, y: nameY - 1, width: nameSize.width, height: nameSize.height });
      text(page, raised, lineStart + 2, dateY, BODY, regular);
      if (stamp) {
        const areaW = CONTENT_W / 3;
        const size = fit(stamp, areaW - 20, DECLARATION_H - STRIP - 10);
        page.drawImage(stamp, {
          x: split + (areaW - size.width) / 2,
          y: top - DECLARATION_H + 8,
          width: size.width,
          height: size.height,
        });
      } else {
        text(page, "Company stamp", split + 12, top - STRIP - 16, BODY, regular, grey);
      }
      cursor -= DECLARATION_H;
    };
    item.pieces.forEach((piece) => {
      if (piece.kind === "notes") drawLines(piece, metrics.noteLines, "SPECIAL INSTRUCTIONS");
      else if (piece.kind === "dims") drawDims(piece);
      else if (piece.kind === "boxes") drawBoxes();
      else if (piece.kind === "statement") drawLines(piece, metrics.statementLines, "CUSTOMS STATEMENT");
      else drawDeclaration();
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
