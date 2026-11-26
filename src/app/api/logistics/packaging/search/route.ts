import { connection } from "next/server";
import { requireLogisticsApi } from "@/features/logistics/commercial-invoice/access";
import { clientError } from "@/features/logistics/commercial-invoice/errors";
import { searchPackagingSkus } from "@/features/logistics/packing/queries";

export async function GET(request: Request) {
  await connection();
  const gate = await requireLogisticsApi();
  if (gate.error) return Response.json({ error: gate.error }, { status: gate.status });
  const query = new URL(request.url).searchParams.get("q") ?? "";
  try {
    const matches = await searchPackagingSkus(query);
    return Response.json({ matches }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: clientError(error, "Could not search packaging.") }, { status: 400 });
  }
}
