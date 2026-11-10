import { connection } from "next/server";
import { syncCin7Products, type SkuSyncRow } from "@/lib/cin7/sync-products";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const header = request.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) {
    return Response.json({ error: "This sync is not authorised." }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) return Response.json({ error: "The service role key is not set." }, { status: 503 });

  try {
    const result = await syncCin7Products({
      async upsert(rows: SkuSyncRow[]) {
        const { error } = await admin.rpc("orbit_sync_sku_effort", { p_rows: rows });
        if (error) throw new Error("Could not save the product sync.");
      },
    });
    return Response.json({ products: result.products, pages: result.pages, message: result.message });
  } catch {
    return Response.json({ error: "Cin7 product sync failed." }, { status: 502 });
  }
}
