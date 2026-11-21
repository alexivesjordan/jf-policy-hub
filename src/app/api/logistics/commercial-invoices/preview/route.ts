import { z } from "zod";
import { requireLogisticsApi } from "@/features/logistics/commercial-invoice/access";
import { clientError } from "@/features/logistics/commercial-invoice/errors";
import { commercialInvoiceFileName, contentDisposition } from "@/features/logistics/commercial-invoice/filename";
import { renderCommercialInvoicePdf } from "@/features/logistics/commercial-invoice/pdf";
import { applyLineEdits, customsFromRpc, draftFromOrders, issuedQuantities, ordersFromCin7, withShipmentPence, type LineEdit } from "@/features/logistics/commercial-invoice/prepare";
import { parseOrderNumbers, validateCommercialInvoice } from "@/features/logistics/commercial-invoice/rules";
import { cin7IsConnected, getCin7Client } from "@/lib/cin7/client";
import type { Cin7Quote } from "@/lib/cin7/types";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  orderNumbers: z.array(z.string().max(40)).min(1).max(10),
  incoterm: z.string().max(12),
  namedPlace: z.string().max(200),
  destinationCountry: z.string().max(8),
  packages: z.number().int().nonnegative(),
  packageType: z.string().max(100),
  grossWeightKg: z.number().finite().nonnegative(),
  buyerVat: z.string().max(80).optional(),
  buyerEori: z.string().max(80).optional(),
  lines: z.array(z.object({
    orderNumber: z.string(),
    sku: z.string(),
    shippedQuantity: z.number().finite().nonnegative(),
    hsCode: z.string(),
    originCountry: z.string(),
    unitWeightKg: z.number().finite().nonnegative().nullable(),
  })).max(200),
}).strict();

async function loadQuotes(numbers: string[]) {
  const client = getCin7Client();
  const quotes: Array<Cin7Quote | undefined> = [];
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const number = numbers[index];
      if (!number) return;
      const sale = await client.getQuote(number);
      if (!sale || !sale.currency || !sale.buyerAddress) throw new Error("Could not load " + number);
      if (sale.usedQuoteLines) throw new Error(number + " has no order lines.");
      quotes[index] = sale;
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, numbers.length) }, () => worker()));
  return quotes.filter((sale): sale is Cin7Quote => sale != null);
}

export async function POST(request: Request) {
  const gate = await requireLogisticsApi();
  if (gate.error) return Response.json({ error: gate.error }, { status: gate.status });
  if (!cin7IsConnected()) return Response.json({ error: "Cin7 is not available." }, { status: 503 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That invoice could not be read." }, { status: 400 });
  let numbers: string[];
  try {
    numbers = parseOrderNumbers(parsed.data.orderNumbers.join(" "));
  } catch (error) {
    return Response.json({ error: clientError(error, "Enter valid order numbers.") }, { status: 400 });
  }
  try {
    const quotes = await loadQuotes(numbers);
    const edits = parsed.data.lines.map((line) => ({ ...line, orderNumber: line.orderNumber.trim().toUpperCase() }));
    const skus = quotes.flatMap((sale) => sale.lines.map((line) => line.sku).filter((sku): sku is string => Boolean(sku)));
    const supabase = await createClient();
    const customs = await supabase.rpc("logistics_product_customs", { p_skus: skus });
    const orders = applyLineEdits(ordersFromCin7(quotes, customsFromRpc(customs.data)), edits as LineEdit[]);
    const prior = await supabase.rpc("logistics_issued_quantities", { p_sales: orders.map((order) => order.id) });
    const draft = withShipmentPence(draftFromOrders(orders, parsed.data), orders, issuedQuantities(prior.data));
    draft.reference = "PREVIEW";
    const errors = validateCommercialInvoice(draft);
    if (errors.length) return Response.json({ error: "Invoice requires review.", details: errors }, { status: 422 });
    const bytes = await renderCommercialInvoicePdf(draft);
    const filename = commercialInvoiceFileName({ buyer: draft.buyer.name, number: "PREVIEW", incoterm: draft.incoterm });
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(filename),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: clientError(error, "The PDF could not be generated.") }, { status: 422 });
  }
}
