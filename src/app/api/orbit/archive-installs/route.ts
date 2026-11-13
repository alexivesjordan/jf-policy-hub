import { connection } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const header = request.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) {
    return Response.json({ error: "This archive run is not authorised." }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) return Response.json({ error: "The service role key is not set." }, { status: 503 });
  const archived = await admin.rpc("install_archive_due");
  if (archived.error) return Response.json({ error: "Could not archive completed installs." }, { status: 502 });
  return Response.json({ archived: Number(archived.data ?? 0) });
}
