import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { draftFromOrders } from "./prepare";
import { renderCommercialInvoicePdf } from "./pdf";
import type { InvoiceOrder } from "./rules";

describe("commercial invoice PDF", () => {
  it("renders Greek and Polish text across more than one page", async () => {
    const lines = Array.from({ length: 40 }, (_, index) => ({
      id: "s-" + index,
      orderNumber: "SO-1",
      sku: "JF-" + index,
      productName: "Ελληνικά Łódź Straße équipement " + index,
      orderedQuantity: 2,
      shippedQuantity: 2,
      unitNetValue: 10,
      lineNetPence: 2000,
      hsCode: "9506910000",
      originCountry: "PL",
      unitWeightKg: 1.25,
    }));
    const orders: InvoiceOrder[] = [{
      id: "s",
      orderNumber: "SO-1",
      buyer: { name: "Αθήνα Gyms Α.Ε.", address: "Οδός 1, Łódź", vat: "", eori: "" },
      consignee: { name: "Αθήνα Gyms Α.Ε.", address: "Οδός 1, Łódź", vat: "", eori: "" },
      country: "GR",
      currency: "EUR",
      warnings: [],
      lines,
    }];
    const draft = draftFromOrders(orders, {
      incoterm: "DAP",
      namedPlace: "Αθήνα",
      destinationCountry: "GR",
      packages: 2,
      packageType: "Pallet",
      grossWeightKg: 120,
    });
    draft.reference = "CI-2026-0001";
    const bytes = await renderCommercialInvoicePdf(draft);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(pdf.getTitle()).toContain("CI-2026-0001");
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
  });
});