import { connection } from "next/server";
import { pulseRpcError, readJson } from "@/lib/pulse/http";
import { markNotificationsSchema } from "@/lib/pulse/schema";
import { pulseSession } from "@/lib/pulse/session";

export async function POST(request: Request) {
  await connection();
  const session = await pulseSession();
  if (!session.ok) return session.response;

  const parsed = markNotificationsSchema.safeParse(await readJson(request));
  if (!parsed.success || (!parsed.data.all && !parsed.data.ids?.length)) {
    return Response.json({ error: "Send all: true, or a list of notification ids." }, { status: 400 });
  }

  const { data, error } = await session.supabase.rpc("orbit_mark_notifications_read", {
    p_ids: parsed.data.all ? null : parsed.data.ids,
  });
  if (error) return pulseRpcError(error, "Could not mark those notifications read.");
  return Response.json({ updated: data ?? 0 });
}
