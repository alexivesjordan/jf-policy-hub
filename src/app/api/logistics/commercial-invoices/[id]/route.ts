import { requireLogisticsApi } from "@/features/logistics/commercial-invoice/access";
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
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
