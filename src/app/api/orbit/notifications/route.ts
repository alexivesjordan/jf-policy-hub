import { connection } from "next/server";
import { pulseRpcError } from "@/lib/pulse/http";
import { pulseSession } from "@/lib/pulse/session";

export async function GET(request: Request) {
  await connection();
  const session = await pulseSession();
  if (!session.ok) return session.response;

  const unread = new URL(request.url).searchParams.get("unread") === "1";
  const { data, error } = await session.supabase.rpc("orbit_list_notifications", {
    p_unread_only: unread,
  });
  if (error) return pulseRpcError(error, "Could not load notifications.");
  return Response.json({ notifications: data ?? [] });
}
