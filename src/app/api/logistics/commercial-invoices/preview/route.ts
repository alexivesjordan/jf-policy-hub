import { requireLogisticsApi } from "@/features/logistics/commercial-invoice/access";
import { clientError } from "@/features/logistics/commercial-invoice/errors";
import { commercialInvoiceFileName, contentDisposition } from "@/features/logistics/commercial-invoice/filename";
import { renderCommercialInvoicePdf } from "@/features/logistics/commercial-invoice/pdf";
import { applyLineEdits, applyOptionalDdp, applyShipment, customsFromRpc, draftFromOrders, issuedQuantities, ordersFromCin7, withShipmentPence, type LineEdit } from "@/features/logistics/commercial-invoice/prepare";
import { previewBodySchema, schemaIssuePaths } from "@/features/logistics/commercial-invoice/shipment-input";
import { inspectPallets } from "@/features/logistics/commercial-invoice/pallets";
import { parseOrderNumbers, validateCommercialInvoice } from "@/features/logistics/commercial-invoice/rules";
import { matchCustomsStatement, prepareCustomsStatement, rulesFromRows } from "@/features/logistics/commercial-invoice/statements";
import { cin7IsConnected, getCin7Client } from "@/lib/cin7/client";
import type { Cin7Quote } from "@/lib/cin7/types";
import { createClient } from "@/lib/supabase/server";

const bodySchema = previewBodySchema;

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
  if (!parsed.success) return Response.json({ error: "That invoice could not be read.", details: schemaIssuePaths(parsed.error) }, { status: 400 });
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
    const rules = rulesFromRows((await supabase.schema("logistics").from("customs_statement_rules").select("incoterm, destination_country, carrier, statement_text, extra_line, priority, active").eq("active", true)).data);
    const checked = inspectPallets(parsed.data.shipment?.palletLines ?? [], "preview");
    if (checked.problems.length) return Response.json({ error: "A pallet is invalid.", details: checked.problems }, { status: 422 });
    const buyerVat = parsed.data.buyerVat ?? parsed.data.shipment?.buyerVat ?? "";
    const requestedId = parsed.data.shipment?.customsStatementId ?? "matched";
    const statement = prepareCustomsStatement({
      incoterm: parsed.data.incoterm,
      statementId: requestedId,
      buyerVat,
      text: requestedId === "matched"
        ? matchCustomsStatement(rules, { incoterm: parsed.data.incoterm, destinationCountry: parsed.data.destinationCountry, carrier: parsed.data.shipment?.courier ?? "" })
        : parsed.data.shipment?.customsStatementText ?? "",
    });
    if (statement.error) return Response.json({ error: statement.error }, { status: 422 });
    let draft;
    try {
      draft = applyOptionalDdp(applyShipment(withShipmentPence(draftFromOrders(orders, parsed.data), orders, issuedQuantities(prior.data)), {
        ...parsed.data.shipment,
        palletLines: checked.pallets,
        customsStatementId: statement.id,
        customsStatementText: statement.text,
        buyerVat,
        buyerEori: parsed.data.buyerEori ?? parsed.data.shipment?.buyerEori,
        grossWeightKg: parsed.data.grossWeightKg,
      }), parsed.data);
    } catch (error) {
      return Response.json({ error: clientError(error, "Shipped quantity is invalid.") }, { status: 400 });
    }
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
