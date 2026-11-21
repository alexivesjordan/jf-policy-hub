import { z } from "zod";

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
    lengthCm: z.number().int().positive().max(1000),
    widthCm: z.number().int().positive().max(1000),
    depthCm: z.number().int().positive().max(1000),
    weightKg: z.number().positive().max(2000).refine((value) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-6),
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
