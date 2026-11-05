import { connection } from "next/server";
import { orbitRpcError, readJson } from "@/lib/orbit/http";
import { markNotificationsSchema } from "@/lib/orbit/schema";
import { orbitSession } from "@/lib/orbit/session";

export async function POST(request: Request) {
  await connection();
  const session = await orbitSession();
  if (!session.ok) return session.response;

  const parsed = markNotificationsSchema.safeParse(await readJson(request));
  if (!parsed.success || (!parsed.data.all && !parsed.data.ids?.length)) {
    return Response.json({ error: "Send all: true, or a list of notification ids." }, { status: 400 });
  }

  const { data, error } = await session.supabase.rpc("orbit_mark_notifications_read", {
    p_ids: parsed.data.all ? null : parsed.data.ids,
  });
  if (error) return orbitRpcError(error, "Could not mark those notifications read.");
  return Response.json({ updated: data ?? 0 });
}
