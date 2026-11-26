import { describe, expect, it } from "vitest";
import { kitFollowUpFrom } from "@/lib/installs/kit-follow-up";
import { isOrderProductLine, orderKitLines } from "@/lib/installs/kit-lines";
import { jobSheetCompleteLine, kitInstalledAsOrdered, kitProblem, sheetPayload, type SheetDraft } from "@/lib/installs/visit-form";

describe("order kit lines", () => {
  it("keeps a stock line and drops totals, discounts, carriage, labour, and picking errors", () => {
    const lines = orderKitLines([
      { sku: "", description: "Picking error sales order total", productLine: null, category: null, qty: 1 },
      { sku: "DISC", description: "Discount", productLine: null, category: null, qty: 1 },
      { sku: "CARR-1", description: "Carriage", productLine: null, category: null, qty: 1 },
      { sku: "LAB-1", description: "Installation labour", productLine: null, category: null, qty: 2 },
      { sku: "SO-00526", description: "Sales order total", productLine: null, category: null, qty: 1 },
      { sku: "JF-C2SE-2", description: "Concept2 SkiErg", productLine: null, category: null, qty: 1 },
    ]);
    expect(lines.map((line) => line.sku)).toEqual(["JF-C2SE-2"]);
  });

  it("rejects a line with no real stock SKU", () => {
    expect(isOrderProductLine({ sku: "12", description: "Bolt" })).toBe(false);
    expect(isOrderProductLine({ sku: "", description: "Concept2 SkiErg" })).toBe(false);
  });
});

function sheet(partial: Partial<SheetDraft> = {}): SheetDraft {
  return {
    visitType: "install",
    sheetOn: "2026-11-13",
    returnedOn: "",
    contactName: "Alex",
    address: "1 High Street",
    phone: "",
    orderNo: "SO-1",
    jobNo: "SO-1",
    serviceContract: null,
    timeOn: "",
    timeOff: "",
    parkingFee: "",
    service: false,
    delivery: true,
    installation: true,
    warranty: false,
    kitAsOrdered: true,
    kitNotes: "",
    kitLines: [],
    lines: [],
    workCarriedOut: "Installed",
    parts: [],
    locationOk: true,
    workOk: true,
    siteOk: true,
    floorSheeting: true,
    builtCheckedTag: true,
    dustCover: true,
    engineerName: "Sam",
    vehicleReg: "",
    customerName: "Gym",
    ...partial,
  };
}

describe("partial kit delivery", () => {
  it("asks for a mark on every order line and allows a line to follow", () => {
    const open = sheet({
      kitAsOrdered: false,
      kitLines: [{ code: "JF-C2SE-2", description: "Concept2 SkiErg", qty: "1", fulfilment: null }],
    });
    expect(kitProblem(open)).toBe("Mark each line as installed or to follow.");
    const partial = sheet({
      kitLines: [
        { code: "JF-C2SE-2", description: "Concept2 SkiErg", qty: "1", fulfilment: "installed" },
        { code: "JF-KBR-3", description: "3 tier kettlebell rack", qty: "2", fulfilment: "to_follow" },
      ],
    });
    expect(kitProblem(partial)).toBeNull();
    expect(kitInstalledAsOrdered(partial)).toBe(false);
    const payload = sheetPayload(partial, {
      engineerSignatureFileId: "11111111-1111-4111-8111-111111111111",
      customerSignatureFileId: "22222222-2222-4222-8222-222222222222",
      pdfFileId: "33333333-3333-4333-8333-333333333333",
    });
    expect(payload.kitAsOrdered).toBe(false);
    expect(kitFollowUpFrom({
      lines: [{ code: "JF-KBR-3", description: "3 tier kettlebell rack", qty: 2, fulfilment: "to_follow" }],
      followUp: { id: "task-1", title: "Kit still to follow", status: "open", body: "2 x 3 tier kettlebell rack" },
    })?.task?.title).toBe("Kit still to follow");
    expect(payload.kitLines).toEqual([
      { code: "JF-C2SE-2", description: "Concept2 SkiErg", qty: "1", fulfilment: "installed" },
      { code: "JF-KBR-3", description: "3 tier kettlebell rack", qty: "2", fulfilment: "to_follow" },
    ]);
  });
});

describe("job sheet completion", () => {
  it("names the order, then the customer, and never leaves a blank", () => {
    expect(jobSheetCompleteLine("SO-00526", "Sample Gym")).toBe("Job sheet for SO-00526 is complete.");
    expect(jobSheetCompleteLine("  ", "Sample Gym")).toBe("Job sheet for Sample Gym is complete.");
    expect(jobSheetCompleteLine("", "")).toBe("Job sheet is complete.");
  });
});
