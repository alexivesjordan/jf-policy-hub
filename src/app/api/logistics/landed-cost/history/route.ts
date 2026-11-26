import { apiError, json, logisticsGate } from "@/features/logistics/landed-cost/http-route";
import { buildQuote } from "@/features/logistics/landed-cost/quote";
import { quoteSchema, shipmentSchema } from "@/features/logistics/landed-cost/schema";
import { quoteShipment } from "@/features/logistics/landed-cost/shipment";
import { insertHistory, listHistory, liveQuoteDeps } from "@/features/logistics/landed-cost/store";
import { loadDutyDocument, withStoredCustoms } from "@/features/logistics/landed-cost/documents";
import { londonDate } from "@/features/logistics/landed-cost/money";

export async function GET() {
  const gate = await logisticsGate();
  if (gate.response) return gate.response;
  try {
    return json({ items: await listHistory() });
  } catch (error) {
    return apiError(error, "Saved calculations could not be read.");
  }
}

export async function POST(request: Request) {
  const gate = await logisticsGate();
  if (gate.response || !gate.profile) return gate.response;
  const body = await request.json().catch(() => null);
  const raw = body && typeof body === "object" ? body as Record<string, unknown> : null;
  if (!raw) return json({ error: "Check the calculation and try again." }, 400);
  const mode = raw.mode;
  const rest = { ...raw };
  delete rest.mode;
  try {
    if (mode === "shipment") {
      const parsed = shipmentSchema.safeParse({ ...rest, action: "calculate" });
      if (!parsed.success) return json({ error: "Check the shipment and try again." }, 400);
      const document = await loadDutyDocument(parsed.data.kind, parsed.data.number);
      const lines = await withStoredCustoms(document.lines, parsed.data.lines ?? null);
      const header = {
        destination: (parsed.data.destination ?? document.destination ?? "GB").toUpperCase(),
        incoterm: parsed.data.incoterm ?? "FOB",
        freight: parsed.data.freight ?? 0,
        insurance: parsed.data.insurance ?? 0,
        otherCharges: parsed.data.otherCharges ?? 0,
        afterBorder: parsed.data.afterBorder ?? 0,
        currency: (parsed.data.currency ?? document.currency ?? "GBP").toUpperCase(),
        rateOverride: parsed.data.rateOverride ?? null,
        asOf: parsed.data.asOf ?? londonDate(),
        claimPreference: parsed.data.claimPreference ?? true,
      };
      const quote = await quoteShipment(header, lines, liveQuoteDeps());
      const saved = await insertHistory(gate.profile.id, {
        mode: "shipment",
        documentKind: parsed.data.kind,
        documentNumber: document.number,
        destination: header.destination,
        origin: null,
        incoterm: header.incoterm,
        currency: header.currency,
        unitsPerGbp: quote.lines.find((line) => line.result)?.result?.unitsPerGbp ?? 1,
        rateSource: quote.lines.find((line) => line.result)?.result?.rateSource ?? "gbp",
        commodityCode: null,
        estimate: quote.estimate,
        stale: quote.stale,
        input: header,
        result: quote,
        lines: quote.lines.map((line) => ({
          sku: line.sku,
          description: line.description,
          hsCode: line.hsCode,
          origin: line.origin,
          quantity: line.quantity,
          goodsValue: line.goodsValue,
          error: line.error,
          result: line.result,
        })),
      });
      return json({ id: saved.id, quote });
    }
    const parsed = quoteSchema.safeParse(rest);
    if (!parsed.success) return json({ error: "Check the calculation and try again." }, 400);
    const quote = await buildQuote(parsed.data, liveQuoteDeps());
    const saved = await insertHistory(gate.profile.id, {
      mode: "calculator",
      documentKind: null,
      documentNumber: null,
      destination: quote.destination,
      origin: quote.origin,
      incoterm: quote.incoterm,
      currency: parsed.data.currency.toUpperCase(),
      unitsPerGbp: quote.unitsPerGbp,
      rateSource: quote.rateSource,
      commodityCode: quote.commodityCode,
      estimate: quote.estimate,
      stale: quote.stale,
      input: parsed.data,
      result: quote,
      lines: [],
    });
    return json({ id: saved.id, quote });
  } catch (error) {
    return apiError(error, "The calculation could not be saved.");
  }
}
