import { describe, expect, it } from "vitest";
import { applyLineEdits, ordersFromCin7, skuQuantityFits, withShipmentPence } from "./prepare";
import type { Cin7Quote } from "@/lib/cin7/types";
import { COMMERCIAL_INVOICE_SELLER } from "./seller";
import { mergeInvoiceOrders } from "./rules";

function duplicateSkuSale(): Cin7Quote {
  return {
    id: "sale-dup",
    number: "SO-DUP",
    customerName: "Acme Gyms Ltd",
    customerRef: "",
    segment: null,
    customerType: null,
    currency: "GBP",
    buyerAddress: "1 Road",
    consigneeAddress: "1 Road",
    destinationCountry: "FR",
    lines: [
      { sku: "CI-DUP", lineId: null, productName: "Bench A", category: null, qty: 2, lineNet: 2, unitWeightKg: 1 },
      { sku: "CI-DUP", lineId: null, productName: "Bench B", category: null, qty: 3, lineNet: 3, unitWeightKg: 1 },
    ],
  };
}

describe("duplicate SKU lines", () => {
  it("keeps a separate edit and amount on each sale line", () => {
    const orders = ordersFromCin7([duplicateSkuSale()], []);
    expect(orders[0]?.lines.map((line) => line.id)).toEqual(["sale-dup:0", "sale-dup:1"]);
    const edited = applyLineEdits(orders, [
      { lineId: "sale-dup:0", orderNumber: "SO-DUP", sku: "CI-DUP", shippedQuantity: 1, hsCode: "950691", originCountry: "cn", unitWeightKg: 1 },
      { lineId: "sale-dup:1", orderNumber: "SO-DUP", sku: "CI-DUP", shippedQuantity: 3, hsCode: "95069100", originCountry: "cn", unitWeightKg: 2 },
    ]);
    expect(edited[0]?.lines.map((line) => line.shippedQuantity)).toEqual([1, 3]);
    expect(edited[0]?.lines.map((line) => line.unitWeightKg)).toEqual([1, 2]);
    const draft = mergeInvoiceOrders(edited, {
      name: COMMERCIAL_INVOICE_SELLER.name,
      address: COMMERCIAL_INVOICE_SELLER.address,
      vat: COMMERCIAL_INVOICE_SELLER.vat,
      eori: COMMERCIAL_INVOICE_SELLER.eoriGb,
    });
    const priced = withShipmentPence(draft, edited);
    expect(priced.lines.map((line) => line.shippedPence)).toEqual([100, 300]);
  });

  it("allows both lines of one SKU and refuses a shipment past their combined quantity", () => {
    const lines = [
      { saleId: "sale-dup", sku: "CI-DUP", lineId: "sale-dup:0", orderedQty: 2, shippedQty: 2 },
      { saleId: "sale-dup", sku: "CI-DUP", lineId: "sale-dup:1", orderedQty: 3, shippedQty: 3 },
    ];
    expect(skuQuantityFits(lines, [])).toBe(true);
    expect(skuQuantityFits(lines, [{ saleId: "sale-dup", sku: "CI-DUP", qty: 1 }])).toBe(false);
    expect(skuQuantityFits(
      [
        { saleId: "sale-dup", sku: "CI-DUP", lineId: "sale-dup:0", orderedQty: 2, shippedQty: 2 },
        { saleId: "sale-dup", sku: "CI-DUP", lineId: "sale-dup:1", orderedQty: 3, shippedQty: 4 },
      ],
      [],
    )).toBe(false);
  });
});
