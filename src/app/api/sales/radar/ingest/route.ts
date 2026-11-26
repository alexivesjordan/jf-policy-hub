import { connection } from "next/server";
import { authorisedCron } from "@/features/radar/cron-auth";
import { runRadarIngest } from "@/features/radar/run";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

export async function GET(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (!authorisedCron(request.headers.get("authorization"), secret)) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) return Response.json({ ok: false }, { status: 503 });
  const lookback = Number(process.env.RADAR_LOOKBACK_DAYS ?? "2");
  try {
    const result = await runRadarIngest(admin, { lookbackDays: lookback });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("Radar ingest failed", error instanceof Error ? error.message : "error");
    return Response.json({ ok: false }, { status: 502 });
  }
}
