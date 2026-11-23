import { z } from "zod";
import { dimensionCounts } from "./pallets";
import type { InvoiceDraft, InvoiceShipment } from "./rules";

/** £1,000,000 in pence. */
const MONEY_MAX = 100_000_000;

function isoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export const shipmentSchema = z.object({
  fao: z.string().max(200).optional(),
  courier: z.string().max(120).optional(),
  despatchDate: z.string().refine((value) => value === "" || isoDate(value), { message: "Despatch date is invalid." }).optional(),
  deliveryAddress: z.string().max(1000).optional(),
  contactName: z.string().max(200).optional(),
  contactEmail: z.union([z.literal(""), z.string().email().max(200)]).optional(),
  specialInstructions: z.string().max(2000).optional(),
  parcels: z.number().int().nonnegative().max(999).optional(),
  pallets: z.number().int().nonnegative().max(30).optional(),
  palletLines: z.array(z.object({
    lengthCm: z.number().finite().nullable().optional(),
    widthCm: z.number().finite().nullable().optional(),
    depthCm: z.number().finite().nullable().optional(),
    weightKg: z.number().finite().nullable().optional(),
    kind: z.enum(["parcel", "pallet"]).optional(),
  })).max(30).optional(),
  deliveryPence: z.number().int().nonnegative().max(MONEY_MAX).optional(),
  surchargePence: z.number().int().nonnegative().max(MONEY_MAX).optional(),
  vatPence: z.number().int().nonnegative().max(MONEY_MAX).optional(),
  customsStatementId: z.enum(["matched", "regime42", "ddp_vat_postponed", "none", "custom"]).optional(),
  customsStatementText: z.string().max(2000).optional(),
  buyerVat: z.string().max(80).optional(),
  buyerEori: z.string().max(80).optional(),
  grossWeightKg: z.number().finite().nonnegative().max(100000).optional(),
}).strict();

export const optionalDdpSchema = {
  importerName: z.string().max(200).optional(),
  importerAddress: z.string().max(1000).optional(),
  importerVat: z.string().max(80).optional(),
  importerEori: z.string().max(80).optional(),
  clearanceCountry: z.string().max(8).optional(),
  procedure: z.enum(["unconfirmed", "40", "42", "transit", "other"]).optional(),
  ddpModel: z.enum(["unspecified", "importers_signature", "own_french_vat", "not_applicable"]).optional(),
  frenchVatNumber: z.string().max(40).optional(),
  statementApprovedBy: z.string().max(200).optional(),
};

const lineSchema = z.object({
  orderNumber: z.string(),
  sku: z.string(),
  lineId: z.string().min(1).max(80),
  shippedQuantity: z.number().finite().nonnegative(),
  hsCode: z.string(),
  originCountry: z.string(),
  unitWeightKg: z.number().finite().nonnegative().nullable(),
});

const sharedBody = {
  orderNumbers: z.array(z.string().max(40)).min(1).max(10),
  incoterm: z.string().max(12),
  namedPlace: z.string().max(200),
  destinationCountry: z.string().max(8),
  grossWeightKg: z.number().finite().nonnegative().max(100000).optional(),
  buyerVat: z.string().max(80).optional(),
  buyerEori: z.string().max(80).optional(),
  shipment: shipmentSchema.optional(),
  ...optionalDdpSchema,
  lines: z.array(lineSchema).max(200),
};

export const previewBodySchema = z.object({
  ...sharedBody,
  packages: z.number().int().nonnegative(),
  packageType: z.string().max(100),
}).strict();

export const issueBodySchema = z.object({
  ...sharedBody,
  idempotencyKey: z.string().uuid(),
  packages: z.number().int().positive(),
  packageType: z.string().min(1).max(100),
}).strict();

export type PalletInput = { lengthCm: number | null; widthCm: number | null; depthCm: number | null; weightKg: number | null; kind?: "parcel" | "pallet" };

function countedRows(rows: PalletInput[]) {
  return rows.filter((row) => [row.lengthCm, row.widthCm, row.depthCm, row.weightKg].every((value) => typeof value === "number" && value > 0));
}

/** Keys the strict shipment schema accepts. `issuedAt` is server-owned and is not one of them. */
export function shipmentBody(shipment: Partial<InvoiceShipment> | undefined, palletLines: PalletInput[], pallets: number) {
  const counted = countedRows(palletLines);
  const counts = counted.length ? dimensionCounts(counted) : { parcels: shipment?.parcels ?? 0, pallets };
  const source: Record<string, unknown> = { ...shipment, palletLines, parcels: counts.parcels, pallets: counts.pallets };
  const body: Record<string, unknown> = {};
  for (const key of shipmentSchema.keyof().options) {
    if (source[key] !== undefined) body[key] = source[key];
  }
  return body;
}

export function commercialInvoiceBody(draft: InvoiceDraft, palletLines: PalletInput[], palletCount: number, grossWeightKg: number) {
  return {
    orderNumbers: draft.orders,
    incoterm: draft.incoterm,
    namedPlace: draft.namedPlace,
    destinationCountry: draft.destinationCountry,
    packages: draft.packages,
    packageType: draft.packageType,
    grossWeightKg,
    buyerVat: draft.buyer.vat,
    buyerEori: draft.buyer.eori,
    shipment: shipmentBody(draft.shipment, palletLines, palletCount),
    ...(draft.incoterm === "DDP" ? {
      importerName: draft.importer.name,
      importerAddress: draft.importer.address,
      importerVat: draft.importer.vat,
      importerEori: draft.importer.eori,
      clearanceCountry: draft.clearanceCountry,
      procedure: draft.procedure,
      ddpModel: draft.ddpModel,
      frenchVatNumber: draft.frenchVatNumber,
      statementApprovedBy: draft.statementApprovedBy,
    } : {}),
    lines: draft.lines.map((line) => ({
      lineId: line.id,
      orderNumber: line.orderNumber,
      sku: line.sku,
      shippedQuantity: line.shippedQuantity,
      hsCode: line.hsCode,
      originCountry: line.originCountry,
      unitWeightKg: line.unitWeightKg,
    })),
  };
}

/** Field paths only. Values from the rejected body are not included. */
export function schemaIssuePaths(error: z.ZodError) {
  return error.issues.flatMap((issue) => {
    const base = issue.path.map((part) => String(part)).join(".");
    if (issue.code === "unrecognized_keys") return issue.keys.map((key) => [base, key].filter(Boolean).join("."));
    return [base || "(root)"];
  });
}
