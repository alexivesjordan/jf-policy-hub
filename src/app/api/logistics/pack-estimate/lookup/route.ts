import { z } from "zod";
import { connection } from "next/server";
import { requireLogisticsApi } from "@/features/logistics/commercial-invoice/access";
import { clientError } from "@/features/logistics/commercial-invoice/errors";
import { demandFromSale } from "@/features/logistics/packing/sale-lines";
import { cin7IsConnected, getCin7Client } from "@/lib/cin7/client";

const bodySchema = z.object({ number: z.string().trim().min(1).max(40) }).strict();

export async function POST(request: Request) {
  await connection();
  const gate = await requireLogisticsApi();
  if (gate.error) return Response.json({ error: gate.error }, { status: gate.status });
  if (!cin7IsConnected()) return Response.json({ error: "Cin7 is not available." }, { status: 503 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter an order or quote number." }, { status: 400 });
  try {
    const sale = await getCin7Client().getQuote(parsed.data.number);
    if (!sale) return Response.json({ error: "No sale or quote with that number." }, { status: 404 });
    return Response.json({
      number: sale.number,
      customerName: sale.customerName,
      fromQuote: Boolean(sale.usedQuoteLines),
      lines: demandFromSale(sale.lines),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: clientError(error, "Cin7 lookup failed.") }, { status: 400 });
  }
}
