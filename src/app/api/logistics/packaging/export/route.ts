import { connection } from "next/server";
import { requireLogisticsApi } from "@/features/logistics/commercial-invoice/access";
import { PACKAGE_CSV_HEADER, packagesToCsv, type PackageCsvRow } from "@/lib/packing/csv";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  await connection();
  const gate = await requireLogisticsApi();
  if (gate.error) return Response.json({ error: gate.error }, { status: gate.status });
  const url = new URL(request.url);
  const search = url.searchParams.get("search") ?? "";
  const missing = url.searchParams.get("missing") === "1";
  const supabase = await createClient();
  const rows: PackageCsvRow[] = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const { data, error } = await supabase.rpc("logistics_list_sku_packages", {
      p_search: search,
      p_missing: missing,
      p_limit: 1000,
      p_offset: offset,
    });
    if (error) return Response.json({ error: "Could not export packaging." }, { status: 400 });
    const page = Array.isArray((data as { rows?: unknown[] } | null)?.rows) ? (data as { rows: Record<string, unknown>[] }).rows : [];
    for (const row of page) rows.push(csvRow(row));
    if (page.length < 1000) break;
  }
  const csv = rows.length ? packagesToCsv(rows) : `${PACKAGE_CSV_HEADER.join(",")}\n`;
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=\"packaging.csv\"",
      "cache-control": "no-store",
    },
  });
}

function csvRow(row: Record<string, unknown>): PackageCsvRow {
  return {
    sku: String(row.sku ?? ""),
    product_name: String(row.product_name ?? ""),
    package_no: Number(row.package_no ?? 1),
    length_cm: num(row.length_cm),
    width_cm: num(row.width_cm),
    height_cm: num(row.height_cm),
    gross_weight_kg: num(row.gross_weight_kg),
    stackable: Boolean(row.stackable),
    max_stack: num(row.max_stack),
    can_be_on_side: Boolean(row.can_be_on_side),
    ships_on_pallet_only: Boolean(row.ships_on_pallet_only),
  };
}

function num(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
