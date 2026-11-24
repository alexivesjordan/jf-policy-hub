import { z } from "zod";
import { requireLogisticsApi } from "@/features/logistics/commercial-invoice/access";
import { clientError } from "@/features/logistics/commercial-invoice/errors";
import { buyerTaxFromHistory, customsFromRpc, ordersFromCin7 } from "@/features/logistics/commercial-invoice/prepare";
import { parseOrderNumbers } from "@/features/logistics/commercial-invoice/rules";
import { cin7IsConnected, getCin7Client } from "@/lib/cin7/client";
import type { Cin7Quote } from "@/lib/cin7/types";
import { createClient } from "@/lib/supabase/server";

const requestSchema = z.object({ orderNumbers: z.string().min(1).max(500) }).strict();

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      out[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

export async function POST(request: Request) {
  const gate = await requireLogisticsApi();
  if (gate.error) return Response.json({ error: gate.error }, { status: gate.status });
  if (!cin7IsConnected()) return Response.json({ error: "Cin7 is not available." }, { status: 503 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter valid order numbers." }, { status: 400 });
  let numbers: string[];
  try { numbers = parseOrderNumbers(parsed.data.orderNumbers); }
  catch (error) { return Response.json({ error: clientError(error, "Enter valid order numbers.") }, { status: 400 }); }

  const client = getCin7Client();
  let quotes: Cin7Quote[];
  try {
    quotes = await mapLimited(numbers, 3, async (orderNumber) => {
      const sale = await client.getQuote(orderNumber);
      if (!sale) throw new Error("Could not find order " + orderNumber);
      if (sale.usedQuoteLines) throw new Error(orderNumber + " has no order lines.");
      if (!sale.currency) throw new Error(orderNumber + " has no currency.");
      if (!sale.buyerAddress || !sale.destinationCountry) throw new Error(orderNumber + " has no buyer address.");
      return sale;
    });
  } catch (error) {
    const message = clientError(error, "Cin7 lookup failed.");
    return Response.json({ error: message }, { status: message.startsWith("Could not find") ? 404 : 422 });
  }

  const skus = quotes.flatMap((sale) => sale.lines.map((line) => line.sku).filter((sku): sku is string => Boolean(sku)));
  const supabase = await createClient();
  const customs = await supabase.rpc("logistics_product_customs", { p_skus: skus });
  // Issued history is not subtracted. A regeneration, and a second look at an
  // order that already has an invoice, must show the Cin7 ordered quantity.
  const orders = ordersFromCin7(quotes, customsFromRpc(customs.data), []);
  const customerName = orders[0]?.buyer.name ?? "";
  if (customerName) {
    const history = await supabase.schema("logistics").from("commercial_invoices")
      .select("buyer")
      .eq("status", "issued")
      .filter("buyer->>name", "eq", customerName)
      .order("issued_at", { ascending: false })
      .limit(5);
    if (!history.error && Array.isArray(history.data)) {
      const remembered = buyerTaxFromHistory(customerName, orders[0]?.buyer.vat ?? "", history.data.map((row) => {
        const buyer = row.buyer as { name?: string; vat?: string; eori?: string } | null;
        return { name: buyer?.name, vat: buyer?.vat, eori: buyer?.eori };
      }));
      if (orders[0]) orders[0].buyer = { ...orders[0].buyer, vat: remembered.vat, eori: remembered.eori };
    }
  }
  return Response.json({ orders }, { headers: { "Cache-Control": "no-store" } });
}
