import "server-only";

import { cached, type CacheStore } from "@/features/logistics/landed-cost/cache";
import { commodityUrl, hmrcRatesUrl, searchUrl } from "@/features/logistics/landed-cost/exchange";
import { fetchOfficial } from "@/features/logistics/landed-cost/http";
import type { ManualRate } from "@/features/logistics/landed-cost/manual-rates";
import type { QuoteDeps } from "@/features/logistics/landed-cost/quote";
import { parseSearch } from "@/features/logistics/landed-cost/uk-tariff";
import { taricDetailsUrl, taricMeasuresUrl } from "@/features/logistics/landed-cost/taric";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const TARIFF_TTL = 12 * 60 * 60 * 1000;
const RATE_TTL = 24 * 60 * 60 * 1000;

function dbCache(): CacheStore {
  return {
    async get(key) {
      try {
        const supabase = await createClient();
        const { data, error } = await supabase.schema("logistics").from("tariff_cache").select("body, fetched_at, expires_at").eq("cache_key", key).maybeSingle();
        if (error || !data) return null;
        return { body: data.body, fetchedAt: String(data.fetched_at), expiresAt: String(data.expires_at) };
      } catch {
        return null;
      }
    },
    async set(key, body, fetchedAt, expiresAt) {
      const admin = createAdminClient();
      if (!admin) return;
      try {
        await admin.schema("logistics").from("tariff_cache").upsert({ cache_key: key, body, fetched_at: fetchedAt, expires_at: expiresAt }, { onConflict: "cache_key" });
      } catch {
        // A missed cache write still leaves the calculation usable.
      }
    },
  };
}

export function liveQuoteDeps(): QuoteDeps {
  const store = dbCache();
  return {
    async ukCommodity(code, asOf) {
      const hit = await cached(`uk:commodity:${code}:${asOf}`, TARIFF_TTL, store, async () => JSON.parse(await fetchOfficial(commodityUrl(code, asOf))) as unknown);
      return { payload: hit.value, stale: hit.stale };
    },
    async hmrcMonth(month) {
      const hit = await cached(`hmrc:fx:${month}`, RATE_TTL, store, () => fetchOfficial(hmrcRatesUrl(month)));
      return { csv: hit.value, stale: hit.stale };
    },
    async taricHtml(code, origin, asOf) {
      const hit = await cached(`eu:taric:${code}:${origin}:${asOf}`, TARIFF_TTL, store, async () => {
        const measures = await fetchOfficial(taricMeasuresUrl(code, origin, asOf));
        const details = taricDetailsUrl(measures);
        if (!details) throw new Error("EU TARIC did not return a duty.");
        return fetchOfficial(details);
      });
      return { html: hit.value, stale: hit.stale };
    },
    manualRates: listManualRates,
  };
}

export async function searchCommodities(query: string) {
  const hit = await cached(`uk:search:${query.trim().toLowerCase().slice(0, 80)}`, 60 * 60 * 1000, dbCache(), async () => JSON.parse(await fetchOfficial(searchUrl(query))) as unknown);
  return parseSearch(hit.value);
}

export async function listManualRates(): Promise<(ManualRate & { id: string })[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("logistics").from("duty_rates").select("id, destination_country, origin_country, hs_prefix, duty_percent, vat_percent").order("destination_country");
  if (error) throw new Error("Stored rates could not be read.");
  return (data ?? []).map((row) => ({
    id: String(row.id),
    destination: String(row.destination_country),
    origin: row.origin_country ? String(row.origin_country) : null,
    hsPrefix: String(row.hs_prefix),
    dutyPercent: Number(row.duty_percent),
    vatPercent: Number(row.vat_percent),
  }));
}

export type HistoryInsert = {
  mode: "calculator" | "shipment";
  documentKind: "sale" | "purchase" | null;
  documentNumber: string | null;
  destination: string;
  origin: string | null;
  incoterm: string;
  currency: string;
  unitsPerGbp: number;
  rateSource: string;
  commodityCode: string | null;
  estimate: boolean;
  stale: boolean;
  input: unknown;
  result: unknown;
  lines: { sku: string | null; description: string; hsCode: string | null; origin: string | null; quantity: number | null; goodsValue: number | null; error: string | null; result: unknown }[];
};

export async function insertHistory(userId: string, row: HistoryInsert) {
  const supabase = await createClient();
  const inserted = await supabase.schema("logistics").from("landed_cost_calculations").insert({
    created_by: userId,
    mode: row.mode,
    document_kind: row.documentKind,
    document_number: row.documentNumber,
    destination_country: row.destination,
    origin_country: row.origin,
    incoterm: row.incoterm,
    currency: row.currency,
    units_per_gbp: row.unitsPerGbp,
    rate_source: row.rateSource,
    commodity_code: row.commodityCode,
    estimate: row.estimate,
    stale: row.stale,
    input: row.input,
    result: row.result,
  }).select("id, created_at").single();
  if (inserted.error || !inserted.data) throw new Error("The calculation could not be saved.");
  if (row.lines.length) {
    const lines = await supabase.schema("logistics").from("landed_cost_lines").insert(row.lines.map((line, index) => ({
      calculation_id: inserted.data.id,
      line_no: index + 1,
      sku: line.sku,
      description: line.description,
      hs_code: line.hsCode,
      origin_country: line.origin,
      quantity: line.quantity,
      goods_value: line.goodsValue,
      line_error: line.error,
      result: line.result,
    })));
    if (lines.error) throw new Error("The calculation could not be saved.");
  }
  return { id: String(inserted.data.id), createdAt: String(inserted.data.created_at) };
}

export async function listHistory() {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("logistics").from("landed_cost_calculations")
    .select("id, created_at, mode, document_number, destination_country, origin_country, incoterm, currency, estimate, result")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error("Saved calculations could not be read.");
  return data ?? [];
}

export async function readHistory(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("logistics").from("landed_cost_calculations").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("That calculation could not be read.");
  if (!data) return null;
  const lines = await supabase.schema("logistics").from("landed_cost_lines").select("*").eq("calculation_id", id).order("line_no");
  if (lines.error) throw new Error("That calculation could not be read.");
  return { ...data, lines: lines.data ?? [] };
}

export async function deleteHistory(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.schema("logistics").from("landed_cost_calculations").delete().eq("id", id);
  if (error) throw new Error("That calculation could not be deleted.");
}
