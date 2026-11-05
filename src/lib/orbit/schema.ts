import { z } from "zod";

const entitySchema = z.enum(["ops", "core"]);
const entityTable = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);

export const tokenRoundtripSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("roundtrip"),
    purpose: z.enum(["access_form", "portal", "subcontractor_job", "tc_accept"]),
    entity_schema: entitySchema,
    entity_table: entityTable,
    entity_id: z.uuid(),
  }),
  z.object({
    action: z.literal("resolve"),
    token: z.string().trim().min(20).max(200),
  }),
]);

export const markNotificationsSchema = z.object({
  all: z.boolean().optional(),
  ids: z.array(z.uuid()).max(100).optional(),
});

export const createTaskSchema = z.object({
  kind: z.enum(["fleet", "countdown", "exception", "general"]),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(4000).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  due_at: z.string().datetime({ offset: true }).optional(),
  assignee_id: z.uuid().optional(),
  entity_schema: entitySchema.optional(),
  entity_table: entityTable.optional(),
  entity_id: z.uuid().optional(),
});

export const updateTaskSchema = z
  .object({
    status: z.enum(["open", "in_progress", "done", "cancelled"]).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().trim().max(4000).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    due_at: z.string().datetime({ offset: true }).optional(),
    assignee_id: z.uuid().optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "Send a field to change.",
  });

export const gateOverrideSchema = z.object({
  entity_schema: entitySchema.default("ops"),
  entity_table: entityTable,
  entity_id: z.uuid(),
  gate: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(1).max(2000),
});
