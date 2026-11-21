import { COMMERCIAL_INVOICE_SELLER } from "./seller";
import {
  isGoodsLine, mergeInvoiceOrders, normaliseHsCode, shippedLinePence, lineWeightKg, summedNetWeightKg,
  type GoodsLine, type InvoiceDraft, type InvoiceOrder,
} from "./rules";
import type { Cin7Quote } from "@/lib/cin7/types";

export type CustomsRow = { sku: string; hsCode: string | null; origin: string | null; netWeightKg: number | null };

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function customsFromRpc(data: unknown): CustomsRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    if (typeof item.sku !== "string") return [];
    return [{
      sku: item.sku,
      hsCode: typeof item.hsCode === "string" ? item.hsCode : null,
      origin: typeof item.origin === "string" ? item.origin : null,
      netWeightKg: asNumber(item.netWeightKg),
    }];
  });
}
export type LineEdit = { orderNumber: string; sku: string; shippedQuantity: number; hsCode: string; originCountry: string; unitWeightKg: number | null };

export function ordersFromCin7(quotes: Cin7Quote[], customs: CustomsRow[]): InvoiceOrder[] {
  return quotes.map((sale) => {
    const goods = sale.lines.filter((line) => isGoodsLine({ sku: line.sku, productName: line.productName, category: line.cin7Category }));
    return {
      id: sale.id,
      orderNumber: sale.number,
      buyer: { name: sale.customerName, address: sale.buyerAddress ?? "", vat: "", eori: "" },
      consignee: { name: sale.customerName, address: sale.consigneeAddress ?? sale.buyerAddress ?? "", vat: "", eori: "" },
      country: sale.destinationCountry ?? "",
      currency: sale.currency ?? "",
      warnings: [],
      lines: goods.map((line, index) => {
        const saved = customs.find((row) => row.sku === (line.sku ?? ""));
        const ordered = line.qty;
        const goodsLine: GoodsLine = {
          id: sale.id + "-" + index,
          orderNumber: sale.number,
          sku: line.sku ?? "",
          productName: line.productName,
          orderedQuantity: ordered,
          shippedQuantity: 0,
          unitNetValue: line.lineNet != null && ordered > 0 ? line.lineNet / ordered : 0,
          lineNetPence: line.lineNet == null ? undefined : Math.round(line.lineNet * 100),
          hsCode: saved?.hsCode ?? "",
          originCountry: saved?.origin ?? "",
          unitWeightKg: saved?.netWeightKg ?? line.unitWeightKg ?? null,
        };
        return goodsLine;
      }),
    };
  });
}

export function applyLineEdits(orders: InvoiceOrder[], edits: LineEdit[]) {
  return orders.map((order) => ({
    ...order,
    lines: order.lines.map((line) => {
      const edit = edits.find((item) => item.orderNumber === line.orderNumber && item.sku === line.sku);
      if (!edit) return { ...line, shippedQuantity: 0 };
      return {
        ...line,
        shippedQuantity: edit.shippedQuantity,
        hsCode: normaliseHsCode(edit.hsCode) ?? edit.hsCode,
        originCountry: edit.originCountry.trim().toUpperCase(),
        unitWeightKg: edit.unitWeightKg,
      };
    }),
  }));
}

export function draftFromOrders(orders: InvoiceOrder[], input: { incoterm: string; namedPlace: string; destinationCountry: string; packages: number; packageType: string; grossWeightKg: number; buyerVat?: string; buyerEori?: string }) {
  const draft = mergeInvoiceOrders(orders, {
    name: COMMERCIAL_INVOICE_SELLER.name,
    address: COMMERCIAL_INVOICE_SELLER.address,
    vat: COMMERCIAL_INVOICE_SELLER.vat,
    eori: COMMERCIAL_INVOICE_SELLER.eoriGb,
  });
  draft.seller.eori = `${COMMERCIAL_INVOICE_SELLER.eoriGb} / ${COMMERCIAL_INVOICE_SELLER.eoriFr}`;
  draft.incoterm = input.incoterm;
  draft.namedPlace = input.namedPlace;
  if (input.destinationCountry) draft.destinationCountry = input.destinationCountry;
  draft.packages = input.packages;
  draft.packageType = input.packageType;
  draft.netWeightKg = summedNetWeightKg(draft.lines);
  draft.grossWeightKg = input.grossWeightKg;
  draft.buyer.vat = input.buyerVat ?? "";
  draft.buyer.eori = input.buyerEori ?? "";
  draft.reference = "PREVIEW";
  draft.signatory = "Jordan Fitness Ltd";
  draft.physicalShipmentConfirmed = true;
  draft.reasonForExport = "Sale of goods";
  return draft;
}

export function issueLines(draft: InvoiceDraft, orders: InvoiceOrder[]) {
  return draft.lines.filter((line) => line.shippedQuantity > 0).map((line) => {
    const sale = orders.find((order) => order.orderNumber === line.orderNumber);
    return {
      orderNumber: line.orderNumber,
      cin7SaleId: sale?.id ?? "",
      sku: line.sku,
      description: line.productName,
      orderedQty: line.orderedQuantity,
      shippedQty: line.shippedQuantity,
      lineNetPence: line.lineNetPence ?? Math.round(line.orderedQuantity * line.unitNetValue * 100),
      shippedPence: shippedLinePence(line),
      hsCode: normaliseHsCode(line.hsCode),
      origin: line.originCountry,
      unitWeightKg: line.unitWeightKg,
      lineWeightKg: lineWeightKg(line),
    };
  });
}
