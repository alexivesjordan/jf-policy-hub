import { loadDutyDocument, withStoredCustoms } from "@/features/logistics/landed-cost/documents";
import { londonDate } from "@/features/logistics/landed-cost/money";
import { apiError, json, logisticsGate } from "@/features/logistics/landed-cost/http-route";
import { liveQuoteDeps } from "@/features/logistics/landed-cost/store";
import { quoteShipment } from "@/features/logistics/landed-cost/shipment";
import { shipmentSchema } from "@/features/logistics/landed-cost/schema";

export async function POST(request: Request) {
  const gate = await logisticsGate();
  if (gate.response) return gate.response;
  const parsed = shipmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Check the shipment and try again." }, 400);
  try {
    const document = await loadDutyDocument(parsed.data.kind, parsed.data.number);
    if (parsed.data.action === "load") return json(document);
    const lines = await withStoredCustoms(document.lines, parsed.data.lines ?? null);
    const quote = await quoteShipment({
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
    }, lines, liveQuoteDeps());
    return json({ document: { ...document, lines }, quote });
  } catch (error) {
    return apiError(error, "The shipment could not be calculated.");
  }
}
