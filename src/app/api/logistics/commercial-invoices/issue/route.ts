import { requireLogisticsApi } from "@/features/logistics/commercial-invoice/access";
import { clientError } from "@/features/logistics/commercial-invoice/errors";
import { renderCommercialInvoicePdf } from "@/features/logistics/commercial-invoice/pdf";
import { applyLineEdits, applyOptionalDdp, applyShipment, customsFromRpc, draftFromOrders, issuedQuantities, ordersFromCin7, withShipmentPence, type LineEdit } from "@/features/logistics/commercial-invoice/prepare";
import { issueBodySchema, schemaIssuePaths } from "@/features/logistics/commercial-invoice/shipment-input";
import { storeInvoicePdf, type StoredInvoice } from "@/features/logistics/commercial-invoice/publish";
import { inspectPallets } from "@/features/logistics/commercial-invoice/pallets";
import { parseOrderNumbers, validateCommercialInvoice, type InvoiceDraft } from "@/features/logistics/commercial-invoice/rules";
import { matchCustomsStatement, prepareCustomsStatement, rulesFromRows } from "@/features/logistics/commercial-invoice/statements";
import type { Profile } from "@/lib/types";
import { cin7IsConnected, getCin7Client } from "@/lib/cin7/client";
import type { Cin7Quote } from "@/lib/cin7/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = issueBodySchema;

function mayOpenIssued(profile: Profile, issuedBy: string) {
  return issuedBy === profile.id || profile.role === "admin" || profile.workspace_role === "owner" || profile.workspace_role === "admin";
}

function storedFromRpc(data: {
  id: string;
  number: string;
  document: InvoiceDraft;
  pdfPath?: string | null;
  pdfFilename?: string | null;
  issuedBy: string;
}): StoredInvoice {
  return {
    id: data.id,
    number: data.number,
    document: data.document,
    pdfPath: data.pdfPath ?? null,
    pdfFilename: data.pdfFilename ?? null,
    issuedBy: data.issuedBy,
  };
}

export async function POST(request: Request) {
  const gate = await requireLogisticsApi();
  if (gate.error || !gate.profile) return Response.json({ error: gate.error ?? "Sign in required." }, { status: gate.status });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That invoice could not be read.", details: schemaIssuePaths(parsed.error) }, { status: 400 });
  const input = parsed.data;
  const admin = createAdminClient();
  if (!admin) return Response.json({ error: "That invoice could not be saved." }, { status: 500 });

  const existing = await admin.schema("logistics").from("commercial_invoices")
    .select("id, number, document, pdf_path, pdf_filename, issued_by")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existing.data) {
    const row = existing.data as { id: string; number: string; document: InvoiceDraft; pdf_path: string | null; pdf_filename: string | null; issued_by: string };
    if (!mayOpenIssued(gate.profile, row.issued_by)) {
      return Response.json({ error: "You cannot open that invoice." }, { status: 403 });
    }
    try {
      const filename = await storeInvoicePdf({
        id: row.id,
        number: row.number,
        document: row.document,
        pdfPath: row.pdf_path,
        pdfFilename: row.pdf_filename,
        issuedBy: row.issued_by,
      });
      return Response.json({ id: row.id, number: row.number, filename }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json({ error: clientError(error, "That invoice could not be saved.") }, { status: 422 });
    }
  }

  if (!cin7IsConnected()) return Response.json({ error: "Cin7 is not available." }, { status: 503 });
  let numbers: string[];
  try {
    numbers = parseOrderNumbers(input.orderNumbers.join(" "));
  } catch (error) {
    return Response.json({ error: clientError(error, "Enter valid order numbers.") }, { status: 400 });
  }
  const edits = input.lines.map((line) => ({ ...line, orderNumber: line.orderNumber.trim().toUpperCase() }));
  const client = getCin7Client();
  const quotes: Array<Cin7Quote | undefined> = [];
  let cursor = 0;
  try {
    async function worker() {
      for (;;) {
        const index = cursor;
        cursor += 1;
        const number = numbers[index];
        if (!number) return;
        const sale = await client.getQuote(number);
        if (!sale) throw new Error("Could not load " + number);
        if (sale.usedQuoteLines) throw new Error(number + " has no order lines.");
        quotes[index] = sale;
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, numbers.length) }, () => worker()));
  } catch (error) {
    return Response.json({ error: clientError(error, "Cin7 lookup failed.") }, { status: 422 });
  }
  const loaded = quotes.filter((sale): sale is Cin7Quote => sale != null);
  if (loaded.some((sale) => !sale.currency || !sale.buyerAddress || sale.lines.some((line) => line.lineNet == null))) {
    return Response.json({ error: "Price reconciliation is incomplete." }, { status: 422 });
  }
  const supabase = await createClient();
  const skus = loaded.flatMap((sale) => sale.lines.map((line) => line.sku).filter((sku): sku is string => Boolean(sku)));
  const customs = await supabase.rpc("logistics_product_customs", { p_skus: skus });
  const orders = applyLineEdits(ordersFromCin7(loaded, customsFromRpc(customs.data)), edits as LineEdit[]);
  const prior = await supabase.rpc("logistics_issued_quantities", { p_sales: orders.map((order) => order.id) });
  const rules = rulesFromRows((await supabase.schema("logistics").from("customs_statement_rules").select("incoterm, destination_country, carrier, statement_text, extra_line, priority, active").eq("active", true)).data);
  const checked = inspectPallets(input.shipment?.palletLines ?? [], "issue");
  if (checked.problems.length) return Response.json({ error: "A pallet is invalid.", details: checked.problems }, { status: 422 });
  const buyerVat = input.buyerVat ?? input.shipment?.buyerVat ?? "";
  const requestedId = input.shipment?.customsStatementId ?? "matched";
  const statement = prepareCustomsStatement({
    incoterm: input.incoterm,
    statementId: requestedId,
    buyerVat,
    text: requestedId === "matched"
      ? matchCustomsStatement(rules, { incoterm: input.incoterm, destinationCountry: input.destinationCountry, carrier: input.shipment?.courier ?? "" })
      : input.shipment?.customsStatementText ?? "",
  });
  let draft;
  try {
    draft = applyOptionalDdp(applyShipment(withShipmentPence(draftFromOrders(orders, input), orders, issuedQuantities(prior.data)), {
      ...input.shipment,
      palletLines: checked.pallets,
      customsStatementId: statement.id,
      customsStatementText: statement.text,
      buyerVat,
      buyerEori: input.buyerEori ?? input.shipment?.buyerEori,
      grossWeightKg: input.grossWeightKg,
    }), input);
  } catch (error) {
    return Response.json({ error: clientError(error, "Shipped quantity is invalid.") }, { status: 400 });
  }
  const errors = validateCommercialInvoice({ ...draft, reference: "CI-DRAFT" });
  if (errors.length) return Response.json({ error: "Invoice requires review.", details: errors }, { status: 422 });
  try {
    await renderCommercialInvoicePdf({ ...draft, reference: "CI-DRAFT" });
  } catch (error) {
    return Response.json({ error: clientError(error, "The PDF could not be generated.") }, { status: 422 });
  }
  const lines = draft.lines.map((line) => {
    const sale = orders.find((order) => order.orderNumber === line.orderNumber);
    return {
      id: line.id,
      orderNumber: line.orderNumber,
      cin7SaleId: sale?.id ?? "",
      sku: line.sku,
      description: line.productName,
      orderedQty: line.orderedQuantity,
      shippedQty: line.shippedQuantity,
      unitNetValue: line.unitNetValue,
      lineNetPence: line.lineNetPence ?? Math.round(line.orderedQuantity * line.unitNetValue * 100),
      hsCode: line.hsCode,
      origin: line.originCountry,
      unitWeightKg: line.unitWeightKg,
      lineWeightKg: line.unitWeightKg == null ? 0 : Math.round(line.unitWeightKg * line.shippedQuantity * 1000) / 1000,
    };
  });
  const issued = await admin.rpc("logistics_issue_commercial_invoice", {
    p_payload: {
      idempotencyKey: input.idempotencyKey,
      issuedBy: gate.profile.id,
      currency: draft.currency,
      incoterm: draft.incoterm,
      grossWeightKg: draft.grossWeightKg,
      buyer: draft.buyer,
      orders: orders.map((order) => ({ cin7Id: order.id, number: order.orderNumber })),
      lines,
      document: draft,
      shipment: draft.shipment ?? {},
    },
  });
  if (issued.error || !issued.data) {
    return Response.json({ error: clientError(issued.error?.message, "That invoice could not be saved.") }, { status: 422 });
  }
  const saved = storedFromRpc(issued.data as StoredInvoice & { pdfPath?: string | null; pdfFilename?: string | null; issuedBy: string });
  try {
    const filename = await storeInvoicePdf(saved);
    return Response.json({ id: saved.id, number: saved.number, filename }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: clientError(error, "That invoice could not be saved.") }, { status: 422 });
  }
}
