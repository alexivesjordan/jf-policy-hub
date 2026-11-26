import { londonDate } from "@/features/logistics/landed-cost/money";
import { apiError, json, logisticsGate } from "@/features/logistics/landed-cost/http-route";
import { liveQuoteDeps, searchCommodities } from "@/features/logistics/landed-cost/store";
import { parseHmrcCsv } from "@/features/logistics/landed-cost/exchange";
import { buildQuote } from "@/features/logistics/landed-cost/quote";
import { quoteSchema } from "@/features/logistics/landed-cost/schema";

export async function GET(request: Request) {
  const gate = await logisticsGate();
  if (gate.response) return gate.response;
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (query) {
    try {
      return json({ items: await searchCommodities(query) });
    } catch (error) {
      return apiError(error, "Commodity search is unavailable.");
    }
  }
  const currency = (url.searchParams.get("currency") ?? "").trim().toUpperCase();
  const asOf = url.searchParams.get("date") ?? londonDate();
  if (!/^[A-Z]{3}$/.test(currency) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return json({ error: "Enter a currency and a date." }, 400);
  if (currency === "GBP") return json({ unitsPerGbp: 1, source: "gbp", period: null });
  try {
    const month = asOf.slice(0, 7);
    const loaded = await liveQuoteDeps().hmrcMonth(month);
    const rate = parseHmrcCsv(loaded.csv).get(currency);
    if (!rate) return json({ error: "HMRC has no rate for that currency." }, 404);
    return json({ unitsPerGbp: rate.unitsPerGbp, source: loaded.stale ? "saved" : "hmrc", period: rate.start && rate.end ? `${rate.start} – ${rate.end}` : month });
  } catch (error) {
    return apiError(error, "HMRC exchange rates are unavailable.");
  }
}

export async function POST(request: Request) {
  const gate = await logisticsGate();
  if (gate.response) return gate.response;
  const parsed = quoteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Check the calculation and try again." }, 400);
  try {
    return json(await buildQuote(parsed.data, liveQuoteDeps()));
  } catch (error) {
    return apiError(error, "The calculation could not be completed.");
  }
}
