import { quotePdf, shipmentPdf } from "@/features/logistics/landed-cost/pdf";
import { apiError, json, logisticsGate } from "@/features/logistics/landed-cost/http-route";
import { readHistory } from "@/features/logistics/landed-cost/store";
import type { QuoteView } from "@/features/logistics/landed-cost/quote";
import type { ShipmentQuote } from "@/features/logistics/landed-cost/shipment";
import { quoteCsv, shipmentCsv } from "@/features/logistics/landed-cost/csv";

type Params = { params: Promise<{ id: string }> };

function isId(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export async function GET(request: Request, { params }: Params) {
  const gate = await logisticsGate();
  if (gate.response) return gate.response;
  const { id } = await params;
  if (!isId(id)) return json({ error: "That calculation could not be found." }, 404);
  try {
    const saved = await readHistory(id);
    if (!saved) return json({ error: "That calculation could not be found." }, 404);
    const url = new URL(request.url);
    const format = url.searchParams.get("format");
    const heading = saved.document_number ? String(saved.document_number) : "Landed cost";
    if (format === "csv") {
      const body = saved.mode === "shipment" ? shipmentCsv(saved.result as ShipmentQuote) : quoteCsv(saved.result as QuoteView);
      return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="landed-cost-${id}.csv"`, "Cache-Control": "no-store" } });
    }
    if (format === "pdf") {
      const bytes = saved.mode === "shipment" ? await shipmentPdf(saved.result as ShipmentQuote, heading) : await quotePdf(saved.result as QuoteView, heading);
      return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="landed-cost-${id}.pdf"`, "Cache-Control": "no-store" } });
    }
    return json(saved);
  } catch (error) {
    return apiError(error, "That calculation could not be read.");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const gate = await logisticsGate();
  if (gate.response) return gate.response;
  const { id } = await params;
  if (!isId(id)) return json({ error: "That calculation could not be found." }, 404);
  try {
    const { deleteHistory } = await import("@/features/logistics/landed-cost/store");
    await deleteHistory(id);
    return json({ ok: true });
  } catch (error) {
    return apiError(error, "That calculation could not be deleted.");
  }
}
