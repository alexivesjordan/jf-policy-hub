import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { prepareSignaturePng } from "@/lib/installs/signature-image";
import { FORM_NOTICES, type SheetDraft } from "@/lib/installs/visit-form";

const A4 = [595.28, 841.89] as const;
const MARGIN = 36;
const BLACK = rgb(0.1, 0.1, 0.1);
const RED = rgb(0.81, 0, 0.22);
const GREY = rgb(0.35, 0.35, 0.35);
const LINE = rgb(0.75, 0.75, 0.75);
const WASH = rgb(0.96, 0.96, 0.96);

export type VisitPdfPhoto = { label: string; bytes: Uint8Array };

export type VisitPdfInput = {
  sheet: SheetDraft;
  riskLines: { label: string; answer: string }[];
  riskNotes: string;
  engineerSignature?: Uint8Array | null;
  customerSignature?: Uint8Array | null;
  /** Kept so older callers still type-check. Photos stay on the install, not in this pack. */
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

  private width() {
    return A4[0] - MARGIN * 2;
  }

  text(value: string, options?: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number }) {
    const size = options?.size ?? 9;
    const font = options?.bold ? this.bold : this.font;
    const color = options?.color ?? BLACK;
    for (const line of wrap(value, font, size, this.width())) {
      this.ensure(size + 3);
      this.page.drawText(line, { x: MARGIN, y: this.y - size, size, font, color });
      this.y -= size + (options?.gap ?? 2);
    }
  }

  gap(amount = 6) {
    this.y -= amount;
  }

  heading(value: string) {
    this.gap(8);
    this.text(value, { bold: true, size: 11 });
    this.gap(3);
  }

  /** Two facts per row, or one when the value needs the full width. */
  grid(entries: [string, string][], columns: 1 | 2) {
    const labelW = columns === 1 ? 188 : 108;
    const pairW = this.width() / columns;
    for (let index = 0; index < entries.length; index += columns) {
      const slice = entries.slice(index, index + columns);
      const span = slice.length < columns;
      const cells = slice.map(([label, value]) => {
        const box = span ? this.width() : pairW;
        return {
          box,
          label: wrap(label, this.bold, 8, labelW - 8),
          value: wrap(value || "-", this.font, 8, box - labelW - 8),
        };
      });
      const lines = Math.max(1, ...cells.flatMap((cell) => [cell.label.length, cell.value.length]));
      const height = lines * 10 + 8;
      this.ensure(height);
      const top = this.y;
      let x = MARGIN;
      cells.forEach((cell) => {
        const box = cell.box;
        this.page.drawRectangle({ x, y: top - height, width: labelW, height, color: WASH, borderColor: LINE, borderWidth: 0.6 });
        this.page.drawRectangle({ x: x + labelW, y: top - height, width: box - labelW, height, borderColor: LINE, borderWidth: 0.6 });
        cell.label.forEach((line, lineIndex) => {
          this.page.drawText(line, { x: x + 4, y: top - 12 - lineIndex * 10, size: 8, font: this.bold, color: GREY });
        });
        cell.value.forEach((line, lineIndex) => {
          this.page.drawText(line, { x: x + labelW + 4, y: top - 12 - lineIndex * 10, size: 8, font: this.font, color: BLACK });
        });
        x += box;
      });
      this.y = top - height;
    }
  }

  box(value: string) {
    const lines = wrap(value || "-", this.font, 8, this.width() - 12);
    const height = lines.length * 10 + 8;
    this.ensure(height);
    const top = this.y;
    this.page.drawRectangle({ x: MARGIN, y: top - height, width: this.width(), height, borderColor: LINE, borderWidth: 0.6 });
    lines.forEach((line, index) => {
      this.page.drawText(line, { x: MARGIN + 6, y: top - 12 - index * 10, size: 8, font: this.font, color: BLACK });
    });
    this.y = top - height;
  }

  async signatures(input: {
    date: string;
    vehicle: string;
    engineerName: string;
    customerName: string;
    engineer?: Uint8Array | null;
    customer?: Uint8Array | null;
  }) {
    const terms = [FORM_NOTICES.signing, FORM_NOTICES.hours].flatMap((line) => wrap(line, this.font, 8, this.width()));
    const boxW = (this.width() - 10) / 2;
    const sigH = 58;
    const height = 6 + terms.length * 10 + 8 + 22 + 16 + sigH + 8;
    if (this.y - height < MARGIN) this.newPage();
    this.gap(8);
    for (const line of terms) {
      this.page.drawText(line, { x: MARGIN, y: this.y - 8, size: 8, font: line === terms[0] ? this.bold : this.font, color: line === terms[0] ? BLACK : GREY });
      this.y -= 10;
    }
    this.gap(6);
    this.grid([
      ["Date", input.date || "-"],
      ["Vehicle reg", input.vehicle || "-"],
    ], 2);
    this.gap(6);
    const top = this.y;
    const engineer = await this.embed(input.engineer);
    const customer = await this.embed(input.customer);
    this.signBox(MARGIN, top, boxW, sigH, `Engineer · ${input.engineerName || "-"}`, engineer);
    this.signBox(MARGIN + boxW + 10, top, boxW, sigH, `Customer · ${input.customerName || "-"}`, customer);
    this.y = top - (16 + sigH);
  }

  private signBox(x: number, top: number, width: number, sigH: number, caption: string, image: PDFImage | null) {
    this.page.drawText(winAnsi(caption).slice(0, 48), { x, y: top - 9, size: 8, font: this.bold, color: BLACK });
    this.page.drawRectangle({ x, y: top - 16 - sigH, width, height: sigH, borderColor: LINE, borderWidth: 0.6 });
    if (!image) return;
    const scale = Math.min((width - 12) / image.width, (sigH - 10) / image.height, 1);
    const w = image.width * scale;
    const h = image.height * scale;
    this.page.drawImage(image, { x: x + (width - w) / 2, y: top - 16 - sigH + (sigH - h) / 2, width: w, height: h });
  }

  private async embed(bytes: Uint8Array | null | undefined) {
    if (!bytes || bytes.length < 8) return null;
    try {
      const prepared = await prepareSignaturePng(bytes);
      return isPng(prepared) ? await this.doc.embedPng(prepared) : await this.doc.embedJpg(prepared);
    } catch {
      return null;
    }
  }

  async bytes() {
    return this.doc.save();
  }
}

export async function buildVisitPdf(input: VisitPdfInput) {
  const sheet = input.sheet;
  const pdf = await SheetPdf.create(`Installation / Service Form ${sheet.orderNo || sheet.jobNo || ""}`.trim(), sheet.customerName || "Jordan Fitness");
  pdf.text("JORDAN FITNESS", { bold: true, size: 13, color: RED });
  pdf.text("INSTALLATION / SERVICE FORM", { bold: true, size: 12 });
  pdf.gap(2);
  pdf.text("Jordan HQ, 56 Oldmedow Road, Hardwick Industrial Estate, King's Lynn, PE30 4PP", { size: 8, color: GREY });
  pdf.text("+44 (0)1553 763285    sales@jordanfitness.co.uk    www.jordanfitness.com", { size: 8, color: GREY });
  pdf.gap(8);
  pdf.grid([
    ["Visit type", sheet.visitType === "service" ? "Service" : "Install"],
    ["Date", sheet.sheetOn || "-"],
    ["Contact", sheet.contactName || "-"],
    ["Order no.", sheet.orderNo || "-"],
    ["Telephone", sheet.phone || "-"],
    ["Job no.", sheet.jobNo || "-"],
    ["Service contract", yesNo(sheet.serviceContract)],
    ["Date returned", sheet.returnedOn || "-"],
    ["Time on site", sheet.timeOn || "-"],
    ["Time off site", sheet.timeOff || "-"],
    ["Parking fee", sheet.parkingFee ? `GBP ${sheet.parkingFee}` : "-"],
  ], 2);
  pdf.grid([["Address", sheet.address || "-"]], 1);
  pdf.heading("Checks");
  pdf.grid([
    ["Service", yesNo(sheet.service)],
    ["Delivery", yesNo(sheet.delivery)],
    ["Installation", yesNo(sheet.installation)],
    ["Warranty", yesNo(sheet.warranty)],
    ["Location satisfactory", yesNo(sheet.locationOk)],
    ["Customer satisfied", yesNo(sheet.workOk)],
    ["Site left satisfactory", yesNo(sheet.siteOk)],
  ], 2);
  pdf.grid([["All kit installed as ordered", sheet.kitAsOrdered ? "Yes" : "No"]], 1);
  pdf.grid([["Anything missing or damaged", sheet.kitNotes.trim() || "None"]], 1);
  pdf.heading("Work carried out");
  pdf.box(sheet.workCarriedOut || "-");
  const parts = sheet.parts.filter((part) => part.code || part.description);
  pdf.heading("Parts used");
  if (parts.length === 0) pdf.box("None recorded.");
  else {
    pdf.grid(parts.map((part) => [`${part.code || "-"} · ${part.description || "-"}`, `Qty ${part.qty || "1"}`]), 1);
  }
  pdf.heading("Risk assessment");
  if (input.riskLines.length === 0) pdf.box("Not recorded.");
  else pdf.grid(input.riskLines.map((row) => [row.label, row.answer || "-"]), 1);
  if (input.riskNotes.trim()) pdf.grid([["Notes", input.riskNotes.trim()]], 1);
  await pdf.signatures({
    date: sheet.sheetOn || "-",
    vehicle: sheet.vehicleReg || "-",
    engineerName: sheet.engineerName,
    customerName: sheet.customerName,
    engineer: input.engineerSignature,
    customer: input.customerSignature,
  });
  return pdf.bytes();
}
