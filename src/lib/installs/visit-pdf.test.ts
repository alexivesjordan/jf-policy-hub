import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { sniffStoredFile } from "@/lib/installs/compress-image";
import { blankLine, blankPart, type SheetDraft } from "@/lib/installs/visit-form";
import { buildVisitPdf } from "@/lib/installs/visit-pdf";
import { pdfBytesToLayoutText } from "@/lib/quotes/pdf-text";

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

function sheet(): SheetDraft {
  return {
    visitType: "install",
    sheetOn: "2026-11-13",
    returnedOn: "2026-11-14",
    contactName: "Alex Customer",
    address: "1 High Street, King's Lynn",
    phone: "01553 000000",
    orderNo: "SO-100",
    jobNo: "JOB-9",
    serviceContract: false,
    callOutCharge: true,
    timeOn: "09:00",
    timeOff: "15:30",
    overnightStay: false,
    parkingFee: "4.50",
    service: false,
    delivery: true,
    installation: true,
    warranty: false,
    ladderCheck: true,
    lines: [{ code: "EL-1", description: "Elite lat pulldown", reportedJob: "Install" }],
    workCarriedOut: "Installed the lat pulldown and levelled it.",
    parts: [{ code: "BOLT", description: "Anchor bolt", qty: "8" }],
    locationOk: true,
    fixingWall: false,
    fixingFloor: true,
    workOk: true,
    siteOk: true,
    engineerName: "Lewis",
    vehicleReg: "AB12 CDE",
    customerName: "Jordan Gym",
  };
}

describe("visit PDF pack", () => {
  it("prints the job sheet, the risk summary, and the photos", async () => {
    const bytes = await buildVisitPdf({
      sheet: sheet(),
      riskLines: [{ label: "Access route is clear", answer: "Yes" }],
      riskNotes: "Cable tray is low.",
      engineerSignature: png,
      customerSignature: png,
      photos: [{ label: "Equipment 1", bytes: png }],
    });
    expect(Buffer.from(bytes.subarray(0, 5)).toString("utf8")).toBe("%PDF-");
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(4);
    expect(loaded.getTitle()).toContain("SO-100");
    const text = await pdfBytesToLayoutText(bytes);
    expect(text).toContain("INSTALLATION / SERVICE FORM");
    expect(text).toContain("Alex Customer");
    expect(text).toContain("SO-100");
    expect(text).toContain("Installed the lat pulldown");
    expect(text).toContain("Risk assessment");
    expect(text).toContain("Cable tray is low");
    expect(text).toContain("Lewis");
  });

  it("still builds a sheet when optional rows are empty", async () => {
    const draft = sheet();
    draft.lines = [blankLine()];
    draft.parts = [blankPart()];
    draft.parts[0].code = "";
    draft.parts[0].description = "";
    const text = await pdfBytesToLayoutText(await buildVisitPdf({ sheet: draft, riskLines: [], riskNotes: "" }));
    expect(text).toContain("None recorded");
  });

  it("recognises a stored photo or PDF by its bytes", () => {
    expect(sniffStoredFile(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg");
    expect(sniffStoredFile(png)).toBe("image/png");
    expect(sniffStoredFile(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe("application/pdf");
    expect(sniffStoredFile(Uint8Array.from([1, 2, 3, 4]))).toBeNull();
  });
});
