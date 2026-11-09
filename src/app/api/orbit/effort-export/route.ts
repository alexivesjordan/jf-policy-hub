import { connection } from "next/server";
import { pulseSession, requireOpsOwner } from "@/lib/pulse/session";

export async function GET(request: Request) {
  await connection();
  const session = await pulseSession();
  if (!session.ok) return session.response;
  const owner = await requireOpsOwner(session.supabase);
  if (!owner.ok || !owner.owner) return Response.json({ error: "Only the owner can export the effort table." }, { status: 403 });

  const url = new URL(request.url);
  const { data, error } = await session.supabase.rpc("orbit_list_sku_effort", {
    p_search: url.searchParams.get("search") ?? "",
    p_category: url.searchParams.get("category") ?? "",
    p_status: url.searchParams.get("status") ?? "",
    p_needs_assembly: url.searchParams.get("needs") ?? "",
    p_limit: 5000,
    p_offset: 0,
  });
  if (error) return Response.json({ error: "Could not export the effort table." }, { status: 400 });

  const body = data as { rows?: Record<string, unknown>[] } | null;
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  const header = ["sku", "product_name", "cin7_category", "needs_assembly", "crew", "build_minutes", "status", "notes"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(header.map((key) => csvCell(row[key])).join(","));
  }
  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=\"sku-effort.csv\"",
    },
  });
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replaceAll("\"", "\"\"")}"`;
  return text;
}
