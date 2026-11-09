import { connection } from "next/server";
import { pulseRpcError, readJson } from "@/lib/pulse/http";
import { gateOverrideSchema } from "@/lib/pulse/schema";
import { pulseSession, requireOpsOwner } from "@/lib/pulse/session";

export async function POST(request: Request) {
  await connection();
  const session = await pulseSession();
  if (!session.ok) return session.response;

  const owner = await requireOpsOwner(session.supabase);
  if (!owner.ok) return pulseRpcError(owner.error, "Could not check owner access.");
  if (!owner.owner) {
    return Response.json({ error: "Only the owner can override a gate." }, { status: 403 });
  }

  const parsed = gateOverrideSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return Response.json({ error: "A gate and a reason are required." }, { status: 400 });
  }

  const { data, error } = await session.supabase.rpc("orbit_insert_gate_override", {
    p_entity_schema: parsed.data.entity_schema,
    p_entity_table: parsed.data.entity_table,
    p_entity_id: parsed.data.entity_id,
    p_gate: parsed.data.gate,
    p_reason: parsed.data.reason,
  });
  if (error) return pulseRpcError(error, "Could not record that override.");
  return Response.json({ id: data }, { status: 201 });
}
