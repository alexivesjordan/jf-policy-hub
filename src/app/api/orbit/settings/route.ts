import { connection } from "next/server";
import { pulseRpcError } from "@/lib/pulse/http";
import { pulseSession, requireOpsOwner } from "@/lib/pulse/session";

export async function GET() {
  await connection();
  const session = await pulseSession();
  if (!session.ok) return session.response;

  const owner = await requireOpsOwner(session.supabase);
  if (!owner.ok) return pulseRpcError(owner.error, "Could not check owner access.");
  if (!owner.owner) {
    return Response.json({ error: "Only the owner can read these settings." }, { status: 403 });
  }

  const { data, error } = await session.supabase.rpc("orbit_read_settings");
  if (error) return pulseRpcError(error, "Could not load settings.");

  const body = (data ?? {}) as {
    settings?: unknown;
    pricing_settings?: Record<string, unknown> | null;
  };
  const pricing = body.pricing_settings ?? null;

  return Response.json({
    settings: body.settings ?? [],
    pricing_settings: pricing
      ? {
          ...pricing,
          min_job_charge_configured: pricing.min_job_charge != null,
          margin_floor_configured: pricing.margin_floor_pct != null,
        }
      : null,
  });
}
