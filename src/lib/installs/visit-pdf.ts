import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { prepareSignaturePng } from "@/lib/installs/signature-image";
import { FORM_NOTICES, type SheetDraft } from "@/lib/installs/visit-form";

const A4 = [595.28, 841.89] as const;
const MARGIN = 36;
const BLACK = rgb(0.07, 0.07, 0.07);
const RED = rgb(0.81, 0, 0.22);
const GREY = rgb(0.32, 0.32, 0.32);

export type VisitPdfPhoto = { label: string; bytes: Uint8Array };

export type VisitPdfInput = {
  sheet: SheetDraft;
  riskLines: { label: string; answer: string }[];
  riskNotes: string;
  engineerSignature?: Uint8Array | null;
  customerSignature?: Uint8Array | null;
  photos?: VisitPdfPhoto[];
};

function winAnsi(value: string) {
  return value
    .replaceAll("—", "-")
    .replaceAll("–", "-")
    .replaceAll("’", "'")
    .replaceAll("“", '"')
    .replaceAll("”", '"')
    .replace(/[^\n\r\t\x20-\xFF]/g, "")
    .slice(0, 4000);
}

function yesNo(value: boolean | null | undefined) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "-";
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const source = winAnsi(text).replace(/\s+/g, " ").trim();
  if (!source) return ["-"];
  const words = source.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && current) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : ["-"];
}

function isPng(bytes: Uint8Array) {
  return bytes.length > 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

class SheetPdf {
  private page: PDFPage;
  private y: number;
  readonly doc: PDFDocument;
  readonly font: PDFFont;
  readonly bold: PDFFont;

  private constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont) {
    this.doc = doc;
    this.font = font;
    this.bold = bold;
    this.page = doc.addPage([...A4]);
    this.y = A4[1] - MARGIN;
  }

  static async create(title: string, subject: string) {
    const doc = await PDFDocument.create();
    doc.setTitle(winAnsi(title).slice(0, 180));
    doc.setSubject(winAnsi(subject).slice(0, 180));
    doc.setCreator("Jordan Pulse");
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    return new SheetPdf(doc, font, bold);
  }

  private newPage() {
    this.page = this.doc.addPage([...A4]);
    this.y = A4[1] - MARGIN;
  }

  private ensure(height: number) {
    if (this.y - height < MARGIN) this.newPage();
  }

  text(value: string, options?: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number }) {
    const size = options?.size ?? 10;
    const font = options?.bold ? this.bold : this.font;
    const color = options?.color ?? BLACK;
    for (const line of wrap(value, font, size, A4[0] - MARGIN * 2)) {
      this.ensure(size + 4);
      this.page.drawText(line, { x: MARGIN, y: this.y - size, size, font, color });
      this.y -= size + (options?.gap ?? 3);
    }
  }

  rule() {
    this.ensure(8);
    this.page.drawRectangle({ x: MARGIN, y: this.y - 2, width: A4[0] - MARGIN * 2, height: 2, color: RED });
    this.y -= 12;
  }

  pair(left: string, right: string) {
    this.ensure(14);
    const size = 10;
    this.page.drawText(winAnsi(left).slice(0, 80), { x: MARGIN, y: this.y - size, size, font: this.font, color: BLACK });
    this.page.drawText(winAnsi(right).slice(0, 40), { x: A4[0] - MARGIN - 90, y: this.y - size, size, font: this.bold, color: BLACK });
    this.y -= size + 4;
  }

  gap(amount = 8) {
    this.y -= amount;
  }

  async image(bytes: Uint8Array, label: string) {
    let picture: PDFImage;
    try {
      picture = isPng(bytes) ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes);
    } catch {
      this.text(`${label}: the photo could not be printed.`);
      return;
    }
    this.newPage();
    this.text(label, { bold: true, size: 12 });
    const maxWidth = A4[0] - MARGIN * 2;
    const maxHeight = this.y - MARGIN;
    const scale = Math.min(maxWidth / picture.width, maxHeight / picture.height, 1);
    const width = picture.width * scale;
    const height = picture.height * scale;
    this.page.drawImage(picture, { x: MARGIN, y: this.y - height, width, height });
    this.y -= height + 8;
  }

  async bytes() {
    return this.doc.save();
  }
}

export async function buildVisitPdf(input: VisitPdfInput) {
  const sheet = input.sheet;
  const pdf = await SheetPdf.create(`Installation / Service Form ${sheet.orderNo || sheet.jobNo || ""}`.trim(), sheet.customerName || "Jordan Fitness");
  pdf.text("JORDAN FITNESS", { bold: true, size: 14, color: RED });
  pdf.text("INSTALLATION / SERVICE FORM", { bold: true, size: 16 });
  pdf.rule();
  pdf.text("Jordan HQ, 56 Oldmedow Road, Hardwick Industrial Estate, King's Lynn, PE30 4PP", { size: 9, color: GREY });
  pdf.text("+44 (0)1553 763285    sales@jordanfitness.co.uk    www.jordanfitness.com", { size: 9, color: GREY });
  pdf.gap(8);
  pdf.pair("Visit", sheet.visitType === "service" ? "Service" : "Install");
  pdf.pair("Date", sheet.sheetOn || "-");
  pdf.pair("Date returned", sheet.returnedOn || "-");
  pdf.pair("Contact name", sheet.contactName || "-");
  pdf.pair("Order no.", sheet.orderNo || "-");
  pdf.pair("Job no.", sheet.jobNo || "-");
  pdf.text(`Address: ${sheet.address || "-"}`);
  pdf.pair("Telephone", sheet.phone || "-");
  pdf.pair("Service contract", yesNo(sheet.serviceContract));
  pdf.pair("Call out charge", yesNo(sheet.callOutCharge));
  pdf.pair("Time on site", sheet.timeOn || "-");
  pdf.pair("Time off site", sheet.timeOff || "-");
  pdf.pair("Overnight stay", yesNo(sheet.overnightStay));
  pdf.pair("Parking fee", sheet.parkingFee ? `GBP ${sheet.parkingFee}` : "-");
  pdf.pair("Service", yesNo(sheet.service));
  pdf.pair("Delivery", yesNo(sheet.delivery));
  pdf.pair("Installation", yesNo(sheet.installation));
  pdf.pair("Warranty", yesNo(sheet.warranty));
  pdf.pair("Ladder / hop-up check", sheet.ladderCheck ? "Yes" : "No");
  pdf.gap(6);
  pdf.text("Products", { bold: true, size: 12 });
  const lines = sheet.lines.filter((line) => line.code || line.description || line.reportedJob);
  if (lines.length === 0) pdf.text("Code    Description    Reported job");
  for (const line of lines) pdf.text(`${line.code || "-"}    ${line.description || "-"}    ${line.qty || "-"}    ${line.reportedJob || "-"}`);
  pdf.gap(6);
  pdf.text("Work carried out", { bold: true, size: 12 });
  pdf.text(sheet.workCarriedOut || "-");
  pdf.gap(6);
  pdf.text("Parts used", { bold: true, size: 12 });
  const parts = sheet.parts.filter((part) => part.code || part.description);
  if (parts.length === 0) pdf.text("None recorded.");
  for (const part of parts) pdf.text(`${part.code || "-"}    ${part.description || "-"}    Qty ${part.qty || "1"}`);
  pdf.gap(6);
  pdf.pair("Satisfied with rig / product location", yesNo(sheet.locationOk));
  pdf.pair("Customer requested fixing to wall", yesNo(sheet.fixingWall));
  pdf.pair("Customer requested fixing to floor", yesNo(sheet.fixingFloor));
  pdf.pair("Customer satisfied with work", yesNo(sheet.workOk));
  pdf.pair("Site left in satisfactory condition", yesNo(sheet.siteOk));
  pdf.gap(6);
  pdf.text(FORM_NOTICES.fixings, { size: 8, color: GREY });
  pdf.text(FORM_NOTICES.signing, { size: 8, bold: true });
  pdf.text(FORM_NOTICES.receipts, { size: 8, color: GREY });
  pdf.text(FORM_NOTICES.hours, { size: 8, color: GREY });
  pdf.gap(6);
  pdf.pair("Engineer", sheet.engineerName || "-");
  pdf.pair("Vehicle reg", sheet.vehicleReg || "-");
  pdf.pair("Customer name", sheet.customerName || "-");
  if (input.engineerSignature) await pdf.image(await prepareSignaturePng(input.engineerSignature), "Engineer signature");
  if (input.customerSignature) await pdf.image(await prepareSignaturePng(input.customerSignature), "Customer signature");
  pdf.gap(8);
  pdf.text("Risk assessment", { bold: true, size: 12 });
  if (input.riskLines.length === 0) pdf.text("Not recorded.");
  for (const row of input.riskLines) pdf.pair(row.label, row.answer);
  if (input.riskNotes.trim()) pdf.text(`Notes: ${input.riskNotes.trim()}`);
  for (const photo of input.photos ?? []) await pdf.image(photo.bytes, photo.label);
  return pdf.bytes();
}
