import { requireLogisticsApi } from "@/features/logistics/commercial-invoice/access";
import { clientError } from "@/features/logistics/commercial-invoice/errors";
import { contentDisposition } from "@/features/logistics/commercial-invoice/filename";
import { storeInvoicePdf } from "@/features/logistics/commercial-invoice/publish";
import type { InvoiceDraft } from "@/features/logistics/commercial-invoice/rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireLogisticsApi();
  if (gate.error) return Response.json({ error: gate.error }, { status: gate.status });
  const { id } = await context.params;
  const supabase = await createClient();
  const loaded = await supabase.rpc("logistics_invoice_file", { p_id: id });
  const row = loaded.data as { path?: string; filename?: string } | null;
  if (loaded.error || !row?.path) return Response.json({ error: "That invoice was not found." }, { status: 404 });
  const admin = createAdminClient();
  if (!admin) return Response.json({ error: "That invoice was not found." }, { status: 404 });
  const file = await admin.storage.from("commercial-invoices").download(row.path);
  if (file.error || !file.data) return Response.json({ error: "That invoice was not found." }, { status: 404 });
  const filename = row.filename || "commercial-invoice.pdf";
  return new Response(Buffer.from(await file.data.arrayBuffer()), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(filename),
      "Cache-Control": "private, no-store",
    },
  });
}

/** Rebuilds the stored PDF when an issued invoice has no file. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireLogisticsApi();
  if (gate.error) return Response.json({ error: gate.error }, { status: gate.status });
  const { id } = await context.params;
  const admin = createAdminClient();
  if (!admin) return Response.json({ error: "That invoice could not be saved." }, { status: 500 });
  const loaded = await admin.schema("logistics").from("commercial_invoices")
    .select("id, number, document, pdf_path, pdf_filename, issued_by, status")
    .eq("id", id)
    .maybeSingle();
  const row = loaded.data as { id: string; number: string; document: InvoiceDraft; pdf_path: string | null; pdf_filename: string | null; issued_by: string; status: string } | null;
  if (loaded.error || !row || row.status !== "issued") return Response.json({ error: "That invoice was not found." }, { status: 404 });
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
