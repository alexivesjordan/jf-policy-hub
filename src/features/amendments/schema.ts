import { z } from "zod";

export const agentAmendmentSchema = z.object({
  policy_id: z.uuid(),
  proposed_content: z.string().trim().min(1).max(500000),
  summary: z.string().trim().min(1).max(2000),
  legal_change_description: z.string().max(10000).nullable().optional(),
  source_urls: z.array(z.string().trim().min(1).max(2000)).max(20).optional().default([]),
  jurisdiction: z.string().max(200).nullable().optional(),
  effective_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  severity: z.enum(["low", "medium", "high"]),
});
