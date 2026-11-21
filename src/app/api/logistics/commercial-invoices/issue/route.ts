import { z } from "zod";
import { requireLogisticsApi } from "@/features/logistics/commercial-invoice/access";
import { commercialInvoiceFileName } from "@/features/logistics/commercial-invoice/filename";
import { renderCommercialInvoicePdf } from "@/features/logistics/commercial-invoice/pdf";
import { applyLineEdits, customsFromRpc, draftFromOrders, issueLines, ordersFromCin7, type LineEdit } from "@/features/logistics/commercial-invoice/prepare";
import { validateCommercialInvoice } from "@/features/logistics/commercial-invoice/rules";
import { cin7IsConnected, getCin7Client } from "@/lib/cin7/client";
import type { Cin7Quote } from "@/lib/cin7/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  idempotencyKey: z.string().uuid(),
  orderNumbers: z.array(z.string().max(40)).min(1).max(10),
  incoterm: z.string().max(12),
  namedPlace: z.string().max(200),
  destinationCountry: z.string().max(8),
  packages: z.number().int().positive(),
  packageType: z.string().min(1).max(100),
  grossWeightKg: z.number().finite().positive(),
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

export async function POST(request: Request) {
  const gate = await requireLogisticsApi();
  if (gate.error || !gate.profile) return Response.json({ error: gate.error ?? "Sign in required." }, { status: gate.status });
  if (!cin7IsConnected()) return Response.json({ error: "Cin7 is not available." }, { status: 503 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That invoice could not be read." }, { status: 400 });
  const input = parsed.data;
  const client = getCin7Client();
  const quotes: Array<Cin7Quote | undefined> = [];
  let cursor = 0;
  try {
    async function worker() {
      for (;;) {
        const index = cursor;
        cursor += 1;
        const number = input.orderNumbers[index];
        if (!number) return;
        const sale = await client.getQuote(number);
        if (!sale) throw new Error("Could not load " + number);
        quotes[index] = sale;
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, input.orderNumbers.length) }, () => worker()));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Cin7 lookup failed." }, { status: 422 });
  }
  const loaded = quotes.filter((sale): sale is Cin7Quote => sale != null);
  if (loaded.some((sale) => !sale.currency || !sale.buyerAddress || sale.lines.some((line) => line.lineNet == null))) {
    return Response.json({ error: "Price reconciliation is incomplete." }, { status: 422 });
  }
  const supabase = await createClient();
  const skus = loaded.flatMap((sale) => sale.lines.map((line) => line.sku).filter((sku): sku is string => Boolean(sku)));
  const customs = await supabase.rpc("logistics_product_customs", { p_skus: skus });
  const orders = applyLineEdits(ordersFromCin7(loaded, customsFromRpc(customs.data)), input.lines as LineEdit[]);
  const draft = draftFromOrders(orders, input);
  const errors = validateCommercialInvoice({ ...draft, reference: "CI-DRAFT" });
  if (errors.length) return Response.json({ error: "Invoice requires review.", details: errors }, { status: 422 });
  const lines = issueLines(draft, orders);
  const issued = await supabase.rpc("logistics_issue_commercial_invoice", {
    p_payload: {
      idempotencyKey: input.idempotencyKey,
      currency: draft.currency,
      incoterm: draft.incoterm,
      grossWeightKg: draft.grossWeightKg,
      buyer: draft.buyer,
      orders: orders.map((order) => ({ cin7Id: order.id, number: order.orderNumber })),
      lines,
    },
  });
  if (issued.error || !issued.data) {
    return Response.json({ error: issued.error?.message?.replace(/^app:\s*/, "") || "That invoice could not be saved." }, { status: 422 });
  }
  const saved = issued.data as { id: string; number: string; replayed?: boolean };
  const filename = commercialInvoiceFileName({ buyer: draft.buyer.name, number: saved.number, incoterm: draft.incoterm });
  const existing = saved.replayed ? await supabase.rpc("logistics_invoice_file", { p_id: saved.id }) : { data: null };
  const existingFile = existing.data as { path?: string } | null;
  if (!existingFile?.path) {
    draft.reference = saved.number;
    const bytes = await renderCommercialInvoicePdf(draft);
    const admin = createAdminClient();
    if (!admin) return Response.json({ error: "That invoice could not be saved." }, { status: 500 });
    const storagePath = `${saved.id}/${filename}`;
    const uploaded = await admin.storage.from("commercial-invoices").upload(storagePath, Buffer.from(bytes), { contentType: "application/pdf", upsert: false });
    if (uploaded.error) return Response.json({ error: "That invoice could not be saved." }, { status: 500 });
    const attached = await supabase.rpc("logistics_attach_invoice_pdf", { p_id: saved.id, p_path: storagePath, p_filename: filename });
    if (attached.error) return Response.json({ error: "That invoice could not be saved." }, { status: 500 });
  }
  return Response.json({ id: saved.id, number: saved.number, filename }, { headers: { "Cache-Control": "no-store" } });
}
