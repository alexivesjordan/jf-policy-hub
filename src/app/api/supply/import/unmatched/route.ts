import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  await connection();
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return new Response("Sign in required.", { status: 401 });
  const batch = new URL(request.url).searchParams.get("batch") ?? "";
  const result = await supabase.rpc("supply_unmatched", { p_batch: batch });
  if (result.error) return new Response("You cannot download that report.", { status: 403 });
  const rows = Array.isArray(result.data) ? (result.data as { code: string; qty: number }[]) : [];
  const csv = `\uFEFF${["Code,Qty", ...rows.map((row) => `${csvCell(row.code)},${row.qty}`)].join("\r\n")}`;
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=\"unmatched.csv\"",
    },
  });
}

function csvCell(value: string) {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
