import { palletGrossKg } from "./pallets";
import { COMMERCIAL_INVOICE_SELLER, resolveCustomsStatement } from "./seller";
import {
  incotermPlace, isGoodsLine, mergeInvoiceOrders, normaliseHsCode, shippedLinePence, lineWeightKg, summedNetWeightKg,
  type CustomsProcedure, type EuropaDdpModel, type GoodsLine, type InvoiceDraft, type InvoiceOrder, type InvoiceShipment,
} from "./rules";
import type { Cin7Quote } from "@/lib/cin7/types";

export type CustomsRow = { sku: string; hsCode: string | null; origin: string | null; netWeightKg: number | null };

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function buyerTaxFromHistory(customerName: string, taxNumber: string, history: { name?: string | null; vat?: string | null; eori?: string | null }[]) {
  const wanted = customerName.trim().toLowerCase();
  const prior = history.find((row) => (row.name ?? "").trim().toLowerCase() === wanted && Boolean(row.vat?.trim() || row.eori?.trim()));
  return {
    vat: taxNumber.trim() || prior?.vat?.trim() || "",
    eori: prior?.eori?.trim() || "",
  };
}

export function issuedQuantities(data: unknown): IssuedQuantity[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const qty = typeof item.qty === "number" ? item.qty : Number(item.qty);
    if (typeof item.cin7SaleId !== "string" || typeof item.sku !== "string" || typeof item.lineKey !== "string" || !Number.isFinite(qty)) return [];
    return [{ cin7SaleId: item.cin7SaleId, sku: item.sku, lineKey: item.lineKey, qty }];
  });
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
export type LineEdit = { lineId: string; orderNumber: string; sku: string; shippedQuantity: number; hsCode: string; originCountry: string; unitWeightKg: number | null };

function usableOrigin(value: string | null | undefined) {
  const code = value?.trim().toUpperCase() ?? "";
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return code === "EL" ? "GR" : code;
}

function usableHs(value: string | null | undefined) {
  const raw = value?.trim() ?? "";
  if (!raw) return "";
  return normaliseHsCode(raw) ?? "";
}

export function ordersFromCin7(quotes: Cin7Quote[], customs: CustomsRow[], already: IssuedQuantity[] = []): InvoiceOrder[] {
  return quotes.map((sale) => {
    return {
      id: sale.id,
      orderNumber: sale.number,
      buyer: { name: sale.customerName, address: sale.buyerAddress ?? "", vat: sale.buyerVat?.trim() ?? "", eori: "" },
      consignee: { name: sale.customerName, address: sale.consigneeAddress ?? sale.buyerAddress ?? "", vat: "", eori: "" },
      country: sale.destinationCountry ?? "",
      currency: sale.currency ?? "",
      warnings: [],
      specialInstructions: sale.specialInstructions ?? "",
      contactName: sale.contactName ?? "",
      contactEmail: sale.contactEmail ?? "",
      courier: sale.courier ?? "",
      deliveryCity: sale.deliveryCity ?? "",
      deliveryPence: Math.round((sale.additionalCharges ?? [])
        .filter((charge) => /\b(freight|delivery|carriage|shipping)\b/i.test(charge.description))
        .reduce((sum, charge) => sum + charge.amountNet, 0) * 100),
      lines: sale.lines.flatMap((line, index) => {
        if (!isGoodsLine({ sku: line.sku, productName: line.productName, category: line.cin7Category })) return [];
        const saved = customs.find((row) => row.sku === (line.sku ?? ""));
        const ordered = line.qty;
        const id = line.lineId?.trim() || sale.id + ":" + index;
        const prior = already.filter((row) => row.lineKey === id && row.cin7SaleId === sale.id).reduce((sum, row) => sum + row.qty, 0);
        const goodsLine: GoodsLine = {
          id,
          orderNumber: sale.number,
          sku: line.sku ?? "",
          productName: line.productName,
          orderedQuantity: ordered,
          shippedQuantity: Math.max(0, ordered - prior),
          unitNetValue: line.lineNet != null && ordered > 0 ? line.lineNet / ordered : 0,
          lineNetPence: line.lineNet == null ? undefined : Math.round(line.lineNet * 100),
          hsCode: usableHs(line.hsCode) || usableHs(saved?.hsCode),
          originCountry: usableOrigin(line.originCountry) || usableOrigin(saved?.origin),
          unitWeightKg: saved?.netWeightKg ?? line.unitWeightKg ?? null,
        };
        return [goodsLine];
      }),
    };
  });
}

export function applyLineEdits(orders: InvoiceOrder[], edits: LineEdit[]) {
  return orders.map((order) => ({
    ...order,
    lines: order.lines.map((line) => {
      const edit = edits.find((item) => item.lineId === line.id);
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

export function draftFromOrders(orders: InvoiceOrder[], input: { incoterm: string; namedPlace: string; destinationCountry: string; packages: number; packageType: string; grossWeightKg?: number; buyerVat?: string; buyerEori?: string }) {
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
  draft.grossWeightKg = input.grossWeightKg ?? 0;
  draft.buyer.vat = input.buyerVat ?? "";
  draft.buyer.eori = input.buyerEori ?? "";
  draft.reference = "PREVIEW";
  draft.signatory = "Jordan Fitness Ltd";
  draft.physicalShipmentConfirmed = true;
  draft.reasonForExport = "Sale of goods";
  const deliveryPence = orders.reduce((sum, order) => sum + (order.deliveryPence ?? 0), 0);
  draft.shipment = {
    fao: "",
    despatchDate: draft.issueDate,
    deliveryAddress: draft.consignee.address,
    contactName: orders.find((order) => order.contactName)?.contactName ?? "",
    contactEmail: orders.find((order) => order.contactEmail)?.contactEmail ?? "",
    courier: orders.find((order) => order.courier)?.courier ?? "",
    specialInstructions: [...new Set(orders.map((order) => order.specialInstructions?.trim()).filter((note): note is string => Boolean(note)))].join("\n"),
    parcels: input.packages,
    pallets: 0,
    palletLines: [],
    deliveryPence,
    surchargePence: 0,
    vatPence: 0,
    customsStatementId: "none",
    customsStatementText: "",
    issuedAt: new Date().toISOString(),
  };
  draft.freightValue = deliveryPence / 100;
  return draft;
}

export function applyShipment(draft: InvoiceDraft, input: Partial<InvoiceShipment> & { buyerVat?: string; buyerEori?: string; grossWeightKg?: number }): InvoiceDraft {
  const current = draft.shipment ?? {
    fao: "", courier: "", despatchDate: draft.issueDate, deliveryAddress: draft.consignee.address,
    contactName: "", contactEmail: "", specialInstructions: "", parcels: draft.packages, pallets: 0,
    palletLines: [], deliveryPence: 0, surchargePence: 0, vatPence: 0, customsStatementId: "matched",
    customsStatementText: "", issuedAt: new Date().toISOString(),
  };
  const { buyerVat, buyerEori, grossWeightKg, ...rest } = input;
  const shipment: InvoiceShipment = {
    ...current,
    ...rest,
    specialInstructions: current.specialInstructions,
    palletLines: rest.palletLines ?? current.palletLines,
    customsStatementId: rest.customsStatementId ?? current.customsStatementId,
    customsStatementText: resolveCustomsStatement(rest.customsStatementId ?? current.customsStatementId, rest.customsStatementText ?? current.customsStatementText),
    issuedAt: current.issuedAt,
  };
  const palletLines = shipment.palletLines;
  const parcels = shipment.parcels;
  const pallets = palletLines.length || shipment.pallets;
  const packages = parcels > 0 ? parcels : pallets > 0 ? pallets : draft.packages;
  return {
    ...draft,
    shipment: { ...shipment, pallets },
    packages: packages > 0 ? packages : 1,
    packageType: pallets > 0 ? "Pallet" : draft.packageType || "Carton",
    grossWeightKg: palletLines.length ? palletGrossKg(palletLines) : (grossWeightKg ?? draft.grossWeightKg),
    buyer: { ...draft.buyer, vat: buyerVat ?? draft.buyer.vat, eori: buyerEori ?? draft.buyer.eori },
    consignee: { ...draft.consignee, address: shipment.deliveryAddress || draft.consignee.address },
    freightValue: shipment.deliveryPence / 100,
    otherChargesValue: shipment.surchargePence / 100,
    notes: shipment.specialInstructions,
  };
}

export type OptionalDdpInput = {
  importerName?: string;
  importerAddress?: string;
  importerVat?: string;
  importerEori?: string;
  clearanceCountry?: string;
  procedure?: CustomsProcedure;
  ddpModel?: EuropaDdpModel;
  frenchVatNumber?: string;
  statementApprovedBy?: string;
};

/** Importer, clearance, procedure and DDP model are optional. Filled values are kept and checked. */
export function applyOptionalDdp(draft: InvoiceDraft, input: OptionalDdpInput): InvoiceDraft {
  if (draft.incoterm !== "DDP") return draft;
  const procedure = input.procedure ?? "unconfirmed";
  const statement = draft.shipment?.customsStatementText?.trim() ?? "";
  const approvedStatement = procedure === "42" || procedure === "other"
    ? (draft.approvedStatement.trim() || statement)
    : "";
  return {
    ...draft,
    importer: {
      name: input.importerName?.trim() ?? "",
      address: input.importerAddress?.trim() ?? "",
      vat: input.importerVat?.trim() ?? "",
      eori: input.importerEori?.trim() ?? "",
    },
    clearanceCountry: input.clearanceCountry?.trim().toUpperCase() ?? "",
    procedure,
    ddpModel: input.ddpModel ?? "not_applicable",
    frenchVatNumber: input.frenchVatNumber?.trim() ?? "",
    statementApprovedBy: input.statementApprovedBy?.trim() ?? "",
    approvedStatement,
  };
}

export type IssuedQuantity = { cin7SaleId: string; sku: string; lineKey: string; qty: number };

export function issueLines(draft: InvoiceDraft, orders: InvoiceOrder[], already: IssuedQuantity[] = []) {
  const seen = new Map<string, number>();
  return draft.lines.filter((line) => line.shippedQuantity > 0).map((line) => {
    const sale = orders.find((order) => order.orderNumber === line.orderNumber);
    const saleId = sale?.id ?? "";
    const prior = already.find((row) => row.lineKey === line.id)?.qty ?? 0;
    const shippedPence = shippedLinePence(line, prior + (seen.get(line.id) ?? 0));
    seen.set(line.id, (seen.get(line.id) ?? 0) + line.shippedQuantity);
    return {
      id: line.id,
      orderNumber: line.orderNumber,
      cin7SaleId: saleId,
      sku: line.sku,
      description: line.productName,
      orderedQty: line.orderedQuantity,
      shippedQty: line.shippedQuantity,
      unitNetValue: line.unitNetValue,
      lineNetPence: line.lineNetPence ?? Math.round(line.orderedQuantity * line.unitNetValue * 100),
      shippedPence,
      hsCode: normaliseHsCode(line.hsCode),
      origin: line.originCountry,
      unitWeightKg: line.unitWeightKg,
      lineWeightKg: lineWeightKg(line),
    };
  });
}

export function withShipmentPence(draft: InvoiceDraft, orders: InvoiceOrder[], already: IssuedQuantity[] = []): InvoiceDraft {
  const priced = new Map(issueLines(draft, orders, already).map((line) => [line.id, line.shippedPence]));
  return {
    ...draft,
    lines: draft.lines.map((line) => {
      const shippedPence = priced.get(line.id);
      return shippedPence == null ? line : { ...line, shippedPence };
    }),
  };
}
