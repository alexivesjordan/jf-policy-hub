import { describe, expect, it } from "vitest";
import { draftForRegenerate, incomingDraft, mergeRetrievedDraft, sameOrderNumbers, type DimensionRow } from "./retrieve";
import type { InvoiceOrder } from "./rules";

function order(country: string): InvoiceOrder {
  return {
    id: "sale-1",
    orderNumber: "SO-1",
    buyer: { name: "NonStop Gym SA", address: "Rue de Cornavin", vat: "CHE-1", eori: "" },
    consignee: { name: "NonStop Gym SA", address: "Rue de Cornavin", vat: "", eori: "" },
    country,
    currency: "CHF",
    warnings: [],
    lines: [{
      id: "line-1",
      orderNumber: "SO-1",
      sku: "JF-1",
      productName: "Bench",
      orderedQuantity: 4,
      shippedQuantity: 4,
      unitNetValue: 10,
      hsCode: "9506910000",
      originCountry: "CN",
      unitWeightKg: 1,
    }],
    deliveryCity: "Genève",
    boxes: ["Box 1"],
  };
}

describe("retrieve merge", () => {
  it("keeps an edited destination and replaces fields that were not touched", () => {
    const current = incomingDraft([order("GB")]);
    current.destinationCountry = "CH";
    current.namedPlace = "Genève, Switzerland";
    current.incoterm = "EXW";
    const incoming = incomingDraft([order("CH")]);
    incoming.buyer = { ...incoming.buyer, vat: "CHE-NEW" };
    const merged = mergeRetrievedDraft(current, incoming, new Set(["destinationCountry"]));
    expect(merged.destinationCountry).toBe("CH");
    expect(merged.namedPlace).toBe("Genève, Switzerland");
    expect(merged.incoterm).toBe("DAP");
    expect(merged.buyer.vat).toBe("CHE-NEW");
  });

  it("keeps edited dimension rows by leaving that decision to the caller", () => {
    const rows: DimensionRow[] = [{ lengthCm: "20", widthCm: "14", depthCm: "30", weightKg: "12", kind: "parcel" }];
    const current = incomingDraft([order("CH")]);
    current.lines[0]!.shippedQuantity = 1;
    const incoming = incomingDraft([order("CH")]);
    const merged = mergeRetrievedDraft(current, incoming, new Set(["lines"]));
    expect(merged.lines[0]?.shippedQuantity).toBe(1);
    expect(rows[0]?.lengthCm).toBe("20");
  });

  it("restores the ordered quantity when a saved invoice is opened again", () => {
    const saved = incomingDraft([order("CH")]);
    saved.lines[0]!.shippedQuantity = 0;
    const again = draftForRegenerate(saved, ["SO-1"]);
    expect(again.lines[0]?.shippedQuantity).toBe(4);
    expect(again.reference).toBe("PREVIEW");
    expect(again.orders).toEqual(["SO-1"]);
  });

  it("treats a different order number as a new invoice", () => {
    expect(sameOrderNumbers("SO-1", ["SO-1"])).toBe(true);
    expect(sameOrderNumbers("so-1, SO-2", ["SO-1", "SO-2"])).toBe(true);
    expect(sameOrderNumbers("SO-2", ["SO-1"])).toBe(false);
    expect(sameOrderNumbers("SO-", ["SO-1"])).toBe(false);
  });
});
