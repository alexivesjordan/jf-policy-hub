import { z } from "zod";
import { connection } from "next/server";
import { requireLogisticsApi } from "@/features/logistics/commercial-invoice/access";
import { clientError } from "@/features/logistics/commercial-invoice/errors";
import { loadLoadSpace, loadPackagesForSkus } from "@/features/logistics/packing/queries";
import { estimateShipment } from "@/lib/packing/estimate";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  lines: z.array(z.object({
    sku: z.string().trim().max(80),
    name: z.string().trim().max(200).optional(),
    qty: z.number().positive().max(500),
  }).strict()).max(200),
  orderNumbers: z.string().max(500).optional(),
  palletCode: z.string().trim().min(1).max(40),
  maxHeightCm: z.number().int().min(50).max(300),
  maxWeightKg: z.number().positive().max(2000),
  maxParcelWeightKg: z.number().positive().max(100),
  maxParcelLengthCm: z.number().int().min(10).max(300),
  save: z.boolean().optional(),
}).strict();

export async function POST(request: Request) {
  await connection();
  const gate = await requireLogisticsApi();
  if (gate.error) return Response.json({ error: gate.error }, { status: gate.status });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That estimate is invalid." }, { status: 400 });
  const body = parsed.data;
  try {
    const space = await loadLoadSpace(body.palletCode);
    if (!space || space.kind !== "pallet") return Response.json({ error: "Choose a pallet." }, { status: 400 });
    const packages = await loadPackagesForSkus(body.lines.map((line) => line.sku));
    const estimate = estimateShipment({
      lines: body.lines.map((line) => ({ sku: line.sku, name: line.name ?? line.sku, qty: line.qty })),
      packages,
      space,
      maxHeightCm: body.maxHeightCm,
      maxGrossKg: body.maxWeightKg,
      maxParcelWeightKg: body.maxParcelWeightKg,
      maxParcelLengthCm: body.maxParcelLengthCm,
    });
    if (!body.save) return Response.json({ estimate }, { headers: { "Cache-Control": "no-store" } });
    if (!estimate.readyForInvoice) {
      return Response.json({ error: estimate.blockReason || "That estimate cannot fill an invoice.", estimate }, { status: 422 });
    }
    const supabase = await createClient();
    const saved = await supabase.schema("logistics").from("pack_estimates").insert({
      created_by: gate.profile?.id ?? null,
      order_numbers: body.orderNumbers?.trim() ?? "",
      lines: body.lines,
      settings: {
        palletCode: body.palletCode,
        maxHeightCm: body.maxHeightCm,
        maxWeightKg: body.maxWeightKg,
        maxParcelWeightKg: body.maxParcelWeightKg,
        maxParcelLengthCm: body.maxParcelLengthCm,
      },
      result: estimate,
    }).select("id").single();
    if (saved.error || !saved.data) return Response.json({ error: "Could not save that estimate." }, { status: 400 });
    return Response.json({ id: (saved.data as { id: string }).id, estimate }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: clientError(error, "Could not estimate that shipment.") }, { status: 400 });
  }
}
