import { describe, expect, it } from "vitest";
import { applyLineEdits, ordersFromCin7, withShipmentPence } from "./prepare";
import { clientError } from "./errors";
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

describe("Cin7 line prefill", () => {
  it("uses the Cin7 HS code and origin ahead of the saved customs row", () => {
    const sale = duplicateSkuSale();
    sale.lines[0] = { ...sale.lines[0]!, hsCode: "95069190", originCountry: "ES" };
    const orders = ordersFromCin7([sale], [{ sku: "CI-DUP", hsCode: "111111", origin: "CN", netWeightKg: null }]);
    expect(orders[0]?.lines[0]).toMatchObject({ hsCode: "9506919000", originCountry: "ES", shippedQuantity: 2 });
    expect(orders[0]?.lines[1]).toMatchObject({ hsCode: "1111110000", originCountry: "CN", shippedQuantity: 3 });
  });

  it("prefills the remaining shipped quantity and floors a fully issued line at 0", () => {
    const open = ordersFromCin7([duplicateSkuSale()], []);
    expect(open[0]?.lines.map((line) => line.shippedQuantity)).toEqual([2, 3]);
    const partial = ordersFromCin7([duplicateSkuSale()], [], [
      { cin7SaleId: "sale-dup", sku: "CI-DUP", lineKey: "sale-dup:0", qty: 2 },
      { cin7SaleId: "sale-dup", sku: "CI-DUP", lineKey: "sale-dup:1", qty: 1 },
    ]);
    expect(partial[0]?.lines.map((line) => line.shippedQuantity)).toEqual([0, 2]);
    const otherSale = ordersFromCin7([duplicateSkuSale()], [], [
      { cin7SaleId: "other-sale", sku: "CI-DUP", lineKey: "sale-dup:0", qty: 2 },
    ]);
    expect(otherSale[0]?.lines[0]?.shippedQuantity).toBe(2);
  });
});

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

  it("returns the friendly message when a line is already fully shipped", () => {
    const orders = ordersFromCin7([duplicateSkuSale()], []);
    const edited = applyLineEdits(orders, [
      { lineId: "sale-dup:0", orderNumber: "SO-DUP", sku: "CI-DUP", shippedQuantity: 1, hsCode: "950691", originCountry: "cn", unitWeightKg: 1 },
      { lineId: "sale-dup:1", orderNumber: "SO-DUP", sku: "CI-DUP", shippedQuantity: 0, hsCode: "950691", originCountry: "cn", unitWeightKg: 1 },
    ]);
    const draft = mergeInvoiceOrders(edited, {
      name: COMMERCIAL_INVOICE_SELLER.name,
      address: COMMERCIAL_INVOICE_SELLER.address,
      vat: COMMERCIAL_INVOICE_SELLER.vat,
      eori: COMMERCIAL_INVOICE_SELLER.eoriGb,
    });
    let caught: unknown;
    try {
      withShipmentPence(draft, edited, [{ cin7SaleId: "sale-dup", sku: "CI-DUP", lineKey: "sale-dup:0", qty: 2 }]);
    } catch (error) {
      caught = error;
    }
    expect(clientError(caught, "Shipped quantity is invalid.")).toBe("Shipped quantity is above the remaining order quantity.");
  });
});
