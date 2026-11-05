import { connection } from "next/server";
import { orbitRpcError } from "@/lib/orbit/http";
import { orbitSession } from "@/lib/orbit/session";

export async function GET(request: Request) {
  await connection();
  const session = await orbitSession();
  if (!session.ok) return session.response;

  const unread = new URL(request.url).searchParams.get("unread") === "1";
  const { data, error } = await session.supabase.rpc("orbit_list_notifications", {
    p_unread_only: unread,
  });
  if (error) return orbitRpcError(error, "Could not load notifications.");
  return Response.json({ notifications: data ?? [] });
}
