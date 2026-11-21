import { z } from "zod";

export const shipmentSchema = z.object({
  fao: z.string().max(200).optional(),
  courier: z.string().max(120).optional(),
  despatchDate: z.string().max(20).optional(),
  deliveryAddress: z.string().max(1000).optional(),
  contactName: z.string().max(200).optional(),
  contactEmail: z.string().max(200).optional(),
  specialInstructions: z.string().max(2000).optional(),
  parcels: z.number().int().nonnegative().optional(),
  pallets: z.number().int().nonnegative().optional(),
  dimensions: z.array(z.object({
    lengthCm: z.number().finite().nonnegative(),
    widthCm: z.number().finite().nonnegative(),
    heightCm: z.number().finite().nonnegative(),
    weightKg: z.number().finite().nonnegative(),
  })).max(40).optional(),
  deliveryPence: z.number().int().nonnegative().optional(),
  surchargePence: z.number().int().nonnegative().optional(),
  vatPence: z.number().int().nonnegative().optional(),
  customsStatementId: z.enum(["regime42", "ddp_vat_postponed", "none", "custom"]).optional(),
  customsStatementText: z.string().max(2000).optional(),
  buyerVat: z.string().max(80).optional(),
  buyerEori: z.string().max(80).optional(),
  grossWeightKg: z.number().finite().nonnegative().optional(),
}).strict();
