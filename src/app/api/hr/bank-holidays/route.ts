import { connection } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const response = await fetch("https://www.gov.uk/bank-holidays.json");
  if (!response.ok) return Response.json({ ok: false }, { status: 502 });
  const body = await response.json() as { "england-and-wales"?: { events?: { date: string; title: string }[] } };
  const rows = (body["england-and-wales"]?.events ?? []).map((event) => ({ date: event.date, title: event.title }));
  const admin = createAdminClient();
  if (!admin) return Response.json({ ok: false }, { status: 500 });
  const saved = await admin.rpc("hr_replace_bank_holidays", { p_region: "england-and-wales", p_rows: rows });
  if (saved.error) return Response.json({ ok: false }, { status: 500 });
  return Response.json({ ok: true, count: rows.length });
}
