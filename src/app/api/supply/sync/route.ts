import { connection } from "next/server";
import { runSupplySyncJob } from "@/lib/supply/sync-job";

export const maxDuration = 300;

export async function GET(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const header = request.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) {
    return Response.json({ error: "This sync is not authorised." }, { status: 401 });
  }
  const result = await runSupplySyncJob();
  if (result.error) return Response.json({ error: result.error }, { status: result.error === "Cin7 is not connected." ? 503 : 502 });
  return Response.json({
    calls: result.calls,
    phase: result.phase,
    done: result.done,
    products: result.products,
    suppliers: result.suppliers,
    stock: result.stock,
    sales: result.sales,
    purchases: result.purchases,
  });
}
