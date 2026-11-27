import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { reorderCsv } from "@/lib/supply/csv";
import type { ReorderGroup } from "@/features/supply/queries";

export async function GET(request: Request) {
  await connection();
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return new Response("Sign in required.", { status: 401 });
  const result = await supabase.rpc("supply_reorder");
  if (result.error) return new Response("You cannot export reorder suggestions.", { status: 403 });
  const supplier = new URL(request.url).searchParams.get("supplier") ?? "";
  const groups = ((result.data as { groups?: ReorderGroup[] } | null)?.groups ?? []);
  const group = groups.find((item) => (item.supplierId ?? "") === supplier) ?? groups[0];
  const rows = (group?.rows ?? []).map((row) => ({ sku: row.sku, qty: row.suggestedQty, currency: group?.currency ?? "GBP" }));
  const name = (group?.supplierName ?? "reorder").replace(/[^\w.-]+/g, "-");
  return new Response(reorderCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="reorder-${name}.csv"`,
    },
  });
}
