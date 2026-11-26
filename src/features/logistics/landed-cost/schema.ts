import { z } from "zod";

const money = z.number().finite().nonnegative().max(1_000_000_000_000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const quoteSchema = z.object({
  destination: z.string().trim().length(2),
  origin: z.string().trim().length(2),
  commodityCode: z.string().trim().min(6).max(16),
  incoterm: z.string().trim().min(3).max(3),
  goodsValue: money,
  freight: money,
  insurance: money,
  otherCharges: money,
  afterBorder: money,
  currency: z.string().trim().length(3),
  rateOverride: z.number().finite().positive().max(1_000_000).nullable(),
  asOf: date,
  quantity: z.number().finite().positive().max(1_000_000).nullable(),
  netWeightKg: z.number().finite().nonnegative().max(1_000_000).nullable(),
  claimPreference: z.boolean(),
}).strict();

export const shipmentSchema = z.object({
  action: z.enum(["load", "calculate"]),
  kind: z.enum(["sale", "purchase"]),
  number: z.string().trim().min(1).max(40),
  destination: z.string().trim().length(2).optional(),
  incoterm: z.string().trim().min(3).max(3).optional(),
  freight: money.optional(),
  insurance: money.optional(),
  otherCharges: money.optional(),
  afterBorder: money.optional(),
  currency: z.string().trim().length(3).optional(),
  rateOverride: z.number().finite().positive().max(1_000_000).nullable().optional(),
  asOf: date.optional(),
  claimPreference: z.boolean().optional(),
  lines: z.array(z.object({
    hsCode: z.string().max(16),
    originCountry: z.string().max(8),
  }).strict()).max(200).optional(),
}).strict();

export const rateSchema = z.object({
  id: z.string().uuid().optional(),
  destination: z.string().trim().length(2),
  origin: z.string().trim().length(2).nullable(),
  hsPrefix: z.string().trim().regex(/^\d{2,10}$/),
  dutyPercent: z.number().finite().nonnegative().max(1000),
  vatPercent: z.number().finite().nonnegative().max(100),
}).strict();
