"use server";

import { createHash } from "node:crypto";
import { classifyLine, type ClassificationRule } from "@/lib/service-quote/classify";
import { calculateServiceQuote, type ServiceQuoteResult } from "@/lib/service-quote/engine";
import { buildServiceProposal } from "@/lib/service-quote/proposal";
import { DEFAULT_SERVICE_RATES, type ServiceRates } from "@/lib/service-quote/rates";
import { ingestCin7Quote, ingestPdfBytes, quoteCacheKey, type IngestedQuote } from "@/lib/quotes/ingest";
import { requireSalesUser } from "@/lib/auth";
import { moduleAllows } from "@/lib/access";
import { getCin7Client } from "@/lib/cin7/client";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/action-state";

export type ServiceQuoteView = {
  id: string | null;
  quoteNumber: string;
  customerName: string;
  rateVersion: string;
  prices: ServiceQuoteResult["sites"];
  portfolioPm: ServiceQuoteResult["portfolioPm"];
  warnings: string[];
  /** Null for a sales rep. Owner, admin, and operations edit see the flags and audit. */
  flags: string[] | null;
  audit: Pick<ServiceQuoteResult, "goodsNetFromLines" | "goodsNetDiscrepancy" | "sites" | "assumptions"> | null;
};

function ratesFromRow(row: Record<string, unknown> | null): { id: string | null; rates: ServiceRates } {
  if (!row) return { id: null, rates: DEFAULT_SERVICE_RATES };
  return {
    id: String(row.id),
    rates: {
      version: String(row.label ?? DEFAULT_SERVICE_RATES.version),
      callout: Number(row.callout_gbp),
      perMachine: Number(row.per_machine_gbp),
      uplift: Number(row.uplift),
      twiceYearlyFactor: Number(row.twice_yearly_factor),
      cardioRate: Number(row.cardio_rate),
      strengthRate: Number(row.strength_rate),
      rackRate: Number(row.rack_rate),
      extensionFactor: Number(row.extension_factor),
      perSite: Number(row.per_site_gbp),
      bundleIncentive: Number(row.bundle_incentive_gbp),
      portfolioFactor: Number(row.portfolio_factor),
    },
  };
}

async function cachedIngest(ingested: IngestedQuote) {
  const supabase = await createClient();
  const existing = await supabase.rpc("service_get_ingest", { p_key: ingested.cacheKey });
  if (!existing.error && existing.data) return { ingestId: null as string | null, ingested: existing.data as IngestedQuote, fromCache: true };
  const saved = await supabase.rpc("service_put_ingest", {
    p_source: ingested.source,
    p_key: ingested.cacheKey,
    p_quote_number: ingested.quoteNumber,
    p_payload: ingested,
  });
  return { ingestId: typeof saved.data === "string" ? saved.data : null, ingested, fromCache: false };
}

async function savedCin7Read(cacheKey: string) {
  const supabase = await createClient();
  const existing = await supabase.rpc("service_get_ingest", { p_key: cacheKey });
  if (existing.error || !existing.data) return null;
  return existing.data as IngestedQuote;
}

export async function loadServiceFromOrder(_state: ActionState, formData: FormData): Promise<ActionState & { ingested?: IngestedQuote }> {
  await requireSalesUser();
  const number = String(formData.get("quoteNumber") ?? "").trim();
  if (!number) return { ok: false, message: "Enter a sales order number." };
  const cacheKey = quoteCacheKey("cin7", number.toLowerCase());
  try {
    const quote = await getCin7Client().getQuote(number);
    if (!quote) return { ok: false, message: "No Cin7 sale has that order number." };
    const ingested = ingestCin7Quote(quote);
    const supabase = await createClient();
    const saved = await supabase.rpc("service_put_ingest", {
      p_source: ingested.source,
      p_key: ingested.cacheKey,
      p_quote_number: ingested.quoteNumber,
      p_payload: ingested,
    });
    const note = saved.error ? " The saved copy could not be updated." : "";
    return { ok: true, message: `Quote loaded from Cin7.${note}`, ingested };
  } catch (error) {
    const saved = await savedCin7Read(cacheKey);
    if (saved) {
      const when = saved.fetchedAt ? ` from ${saved.fetchedAt}` : "";
      return { ok: true, message: `Cin7 could not be read. Showing the last saved copy${when}.`, ingested: saved };
    }
    return { ok: false, message: error instanceof Error ? error.message : "Could not load that order." };
  }
}

export async function loadServiceFromPdf(_state: ActionState, formData: FormData): Promise<ActionState & { ingested?: IngestedQuote }> {
  await requireSalesUser();
  const file = formData.get("quotePdf");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a quote PDF." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const key = quoteCacheKey("pdf", createHash("sha256").update(Buffer.from(bytes)).digest("hex"));
  const supabase = await createClient();
  const existing = await supabase.rpc("service_get_ingest", { p_key: key });
  if (!existing.error && existing.data) {
    return { ok: true, message: "This PDF was already read.", ingested: existing.data as IngestedQuote };
  }
  const parsed = await ingestPdfBytes(bytes);
  parsed.cacheKey = key;
  if (!parsed.lines.length) return { ok: false, message: "No quote lines were found in that PDF.", ingested: parsed };
  const loaded = await cachedIngest(parsed);
  return { ok: true, message: loaded.fromCache ? "This PDF was already read." : "Quote read.", ingested: loaded.ingested };
}

export async function priceIngestedService(ingested: IngestedQuote): Promise<ServiceQuoteView> {
  const profile = await requireSalesUser();
  const supabase = await createClient();
  const [rateRow, ruleRow, flagsAllowed] = await Promise.all([
    supabase.rpc("service_current_rates"),
    supabase.rpc("service_list_rules"),
    supabase.rpc("service_can_see_flags"),
  ]);
  const { id: rateId, rates } = ratesFromRow((rateRow.data ?? null) as Record<string, unknown> | null);
  const rules = (Array.isArray(ruleRow.data) ? ruleRow.data : []).map((row) => {
    const item = row as Record<string, unknown>;
    return {
      matchKind: item.match_kind as ClassificationRule["matchKind"],
      matchValue: String(item.match_value ?? ""),
      category: item.category as ClassificationRule["category"],
      priority: Number(item.priority ?? 100),
    };
  });
  const result = calculateServiceQuote({
    customer: ingested.customerName || "Customer",
    quoteNumber: ingested.quoteNumber,
    currency: "GBP",
    goodsNet: ingested.goodsNet,
    sites: [{
      name: ingested.siteName || ingested.customerName || "Site",
      address: ingested.postcode,
      lineItems: [
        ...ingested.lines.map((line) => {
          const classified = classifyLine({ sku: line.sku, description: line.description, cin7Category: line.cin7Category }, rules);
          return {
            sku: line.sku,
            description: line.description,
            quantity: line.qty,
            lineNet: line.lineNet,
            category: classified.category,
            reviewNote: classified.reasons.join(" "),
          };
        }),
        ...ingested.deliveryInstallLines.map((line) => ({
          description: line.description,
          quantity: 1,
          lineNet: line.amountNet,
          category: "delivery_install",
        })),
      ],
    }],
  }, rates);

  const seeFlags = flagsAllowed.data === true || profile.workspace_role === "owner" || profile.workspace_role === "admin" || moduleAllows(profile, "operations", "edit");
  let id: string | null = null;
  if (rateId) {
    const saved = await supabase.rpc("service_save_quote", {
      p_ingest_id: null,
      p_rate_version_id: rateId,
      p_quote_number: result.quoteNumber,
      p_customer_name: result.customer,
      p_prices: {
        customer: result.customer,
        quoteNumber: result.quoteNumber,
        sites: result.sites.map((site) => ({ name: site.name, address: site.address, prices: site.prices })),
        portfolioPm: result.portfolioPm,
        fetchedAt: ingested.fetchedAt,
      },
      p_audit: result,
    });
    if (typeof saved.data === "string") id = saved.data;
  }

  return {
    id,
    quoteNumber: result.quoteNumber,
    customerName: result.customer,
    rateVersion: result.rateCardVersion,
    prices: result.sites,
    portfolioPm: result.portfolioPm,
    warnings: ingested.warnings,
    flags: seeFlags ? result.flags : null,
    audit: seeFlags
      ? { goodsNetFromLines: result.goodsNetFromLines, goodsNetDiscrepancy: result.goodsNetDiscrepancy, sites: result.sites, assumptions: result.assumptions }
      : null,
  };
}

export async function priceServiceQuote(_state: ActionState, formData: FormData): Promise<ActionState & { service?: ServiceQuoteView; ingested?: IngestedQuote }> {
  const file = formData.get("quotePdf");
  const loaded = file instanceof File && file.size > 0 ? await loadServiceFromPdf(_state, formData) : await loadServiceFromOrder(_state, formData);
  if (!loaded.ingested) return loaded;
  try {
    const service = await priceIngestedService(loaded.ingested);
    return { ok: true, message: "Service prices are ready.", ingested: loaded.ingested, service };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not price that quote.", ingested: loaded.ingested };
  }
}

export async function saveServiceRates(_state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireSalesUser();
  if (profile.workspace_role !== "owner" && profile.workspace_role !== "admin") {
    return { ok: false, message: "Only an owner or admin can change these rates." };
  }
  const supabase = await createClient();
  const number = (name: string) => Number(formData.get(name));
  const { error } = await supabase.rpc("service_save_rates", {
    p_effective_on: String(formData.get("effectiveOn") ?? ""),
    p_callout: number("callout"),
    p_per_machine: number("perMachine"),
    p_uplift: number("uplift"),
    p_twice: number("twiceYearlyFactor"),
    p_cardio: number("cardioRate"),
    p_strength: number("strengthRate"),
    p_rack: number("rackRate"),
    p_extension: number("extensionFactor"),
    p_per_site: number("perSite"),
    p_bundle: number("bundleIncentive"),
    p_portfolio: number("portfolioFactor"),
    p_reason: String(formData.get("reason") ?? ""),
  });
  if (error) return { ok: false, message: "Could not save that rate card." };
  return { ok: true, message: "Rate card saved. New quotes use this version." };
}

export async function saveClassificationRule(_state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireSalesUser();
  if (profile.workspace_role !== "owner" && profile.workspace_role !== "admin") {
    return { ok: false, message: "Only an owner or admin can change classification." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("service_upsert_rule", {
    p_match_kind: String(formData.get("matchKind") ?? ""),
    p_match_value: String(formData.get("matchValue") ?? ""),
    p_category: String(formData.get("category") ?? ""),
    p_priority: Number(formData.get("priority") ?? 100),
    p_note: String(formData.get("note") ?? ""),
  });
  if (error) return { ok: false, message: "Could not save that rule." };
  return { ok: true, message: "Classification rule saved." };
}

export async function generateServiceProposal(_state: ActionState, formData: FormData): Promise<ActionState & { downloadUrl?: string }> {
  await requireSalesUser();
  const quoteId = String(formData.get("serviceQuoteId") ?? "");
  if (!quoteId) return { ok: false, message: "Price the quote before creating the proposal." };
  const supabase = await createClient();
  const loaded = await supabase.rpc("service_read_quote", { p_id: quoteId });
  const row = loaded.data as { prices?: { customer?: string; quoteNumber?: string; sites?: ServiceQuoteResult["sites"]; portfolioPm?: ServiceQuoteResult["portfolioPm"] } } | null;
  if (loaded.error || !row?.prices?.sites) return { ok: false, message: "That quote was not found." };
  const bytes = await buildServiceProposal({
    customer: row.prices.customer ?? "",
    quoteNumber: row.prices.quoteNumber ?? "",
    sites: row.prices.sites,
    portfolioPm: row.prices.portfolioPm ?? null,
  });
  const path = `ops/${quoteId}/${crypto.randomUUID()}.docx`;
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Supabase is not configured." };
  const uploaded = await admin.storage.from("service-proposals").upload(path, bytes, {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: false,
  });
  if (uploaded.error) return { ok: false, message: "Could not store the proposal." };
  const marked = await supabase.rpc("service_set_proposal_path", { p_quote_id: quoteId, p_path: path });
  if (marked.error) return { ok: false, message: "The file was stored, but the quote was not updated." };
  const signed = await admin.storage.from("service-proposals").createSignedUrl(path, 60 * 10);
  if (signed.error || !signed.data?.signedUrl) return { ok: false, message: "The proposal is stored, but the download link could not be made." };
  return { ok: true, message: "Proposal ready. The link lasts 10 minutes.", downloadUrl: signed.data.signedUrl };
}
