"use server";

import { revalidatePath } from "next/cache";
import { cin7IsConnected, getCin7Client } from "@/lib/cin7/client";
import { fillMissingSkuCategories } from "@/lib/cin7/missing-product";
import { cin7Get } from "@/lib/cin7/transport";
import type { Cin7Quote } from "@/lib/cin7/types";
import { getCurrentProfile, requireOperationsUser, requireSalesUser } from "@/lib/auth";
import { seesInstallBreakdown } from "@/lib/pulse/quote-access";
import { isFixtureMode } from "@/lib/env";
import { planDay, type PoolResource } from "@/lib/pulse/availability";
import { addIsoDays, planRange, weekendBookingError, workingDaysFrom } from "@/lib/pulse/booking-range";
import type { JobRequirements, VanSize } from "@/lib/pulse/requirements";
import { canOverrideRequirements } from "@/lib/pulse/requirements";
import { loadBundledEffortTable } from "@/lib/pricer/effort-table";
import type { QuoteBreakdown } from "@/lib/pricer/breakdown";
import type { InstallPriceNotesData } from "@/components/price-workings";
import { effortRowForSku, forSales, priceInstall, type CategoryEffortDefault, type PricingConfig, type Segment } from "@/lib/pricer/engine";
import { tilesFromSale } from "@/lib/pricer/flooring";
import { looksLikeUkPostcode, normaliseUkPostcode } from "@/lib/quotes/postcode";
import { pdfBytesToLayoutText } from "@/lib/quotes/pdf-text";
import { cin7CoreExtractor } from "@/lib/quotes/parse-cin7-core";
import type { ExtractedQuote } from "@/lib/quotes/types";
import { getOfficeContext } from "@/features/operations/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { messageFromError } from "@/lib/errors";
import type { ActionState } from "@/lib/action-state";
import { ingestDraft } from "@/lib/quotes/ingest";
import { priceIngestedService, type ServiceQuoteView } from "@/features/sales/service-actions";

const SEGMENTS = ["independent", "franchisee", "trade", "big_corporate"] as const;

export type ReviewLine = {
  sku: string;
  description: string;
  qty: number;
  category: string;
  lineTotal: number | null;
  unitWeightKg: number | null;
  productId: string;
  uom?: string | null;
  tileLength?: number | null;
  tileWidth?: number | null;
  dimensionUnit?: string | null;
  tilesPerPack?: number | null;
};

export type QuoteDraft = {
  quoteNumber: string;
  customerName: string;
  postcode: string;
  segment: string;
  customerReference: string;
  lines: ReviewLine[];
  goodsNet: number | null;
  warnings: string[];
  source: "fixture" | "pdf" | "cin7";
  customerId: string;
  saleId: string;
  /** Shown to the install lead only. Not a rep-facing error. */
  internalNote: string;
};

export type PricedQuote = ReturnType<typeof forSales> & {
  quoteNumber: string;
  customerName: string;
  postcode: string;
  jobId?: string;
  showCost: boolean;
  requirements: JobRequirements | null;
  repSummary?: { cost: number; price: number; margin: number | null } | null;
  warnings: string[];
  breakdown?: QuoteBreakdown | null;
  priceNotes?: InstallPriceNotesData | null;
  segment?: string | null;
  cost?: number | null;
  markup?: number | null;
  marginFloorPrice?: number | null;
  minJobChargeConfigured?: boolean;
  marginFloorConfigured?: boolean;
  flags?: string[];
  service?: ServiceQuoteView | null;
  provisionalItems?: string[];
  bigInstallTriggers?: string[];
};

async function categoryDefaults(): Promise<CategoryEffortDefault[]> {
  const admin = createAdminClient();
  if (!admin) return [];
  const { data, error } = await admin.rpc("orbit_cin7_category_defaults");
  if (error || !Array.isArray(data)) return [];
  return (data as { category: string; build_crew: number | null; build_minutes: number | null; needs_assembly: boolean | null; notes: string | null }[]).map((row) => ({
    category: row.category,
    buildCrew: row.build_crew ?? 2,
    buildMinutes: row.build_minutes ?? 120,
    note: row.notes ?? "",
    needsAssembly: row.needs_assembly,
  }));
}

async function effortTableFor(lines: { sku: string }[]) {
  const bundled = loadBundledEffortTable();
  const admin = createAdminClient();
  const skus = lines.map((line) => line.sku).filter(Boolean);
  if (!admin || skus.length === 0) return bundled;
  const { data, error } = await admin.rpc("orbit_sku_effort_for_pricing", { p_skus: skus });
  if (error || !Array.isArray(data)) return bundled;
  const rows = (data as {
    sku: string;
    product_name: string;
    cin7_category: string | null;
    needs_assembly: boolean | null;
    crew: number | null;
    build_minutes: number | null;
    build_location?: "hq" | "site" | null;
    hq_build_minutes?: number | null;
    hq_build_crew?: number | null;
    site_position_minutes?: number | null;
    suggestion_rule?: string | null;
    status?: string | null;
    effort_unit?: "each" | "tile" | "m2" | null;
  }[]).map((row) =>
    effortRowForSku({
      sku: row.sku,
      productName: row.product_name,
      category: row.cin7_category,
      needsAssembly: row.needs_assembly,
      crew: row.crew,
      buildMinutes: row.build_minutes,
      buildLocation: row.build_location,
      hqBuildMinutes: row.hq_build_minutes,
      hqBuildCrew: row.hq_build_crew,
      sitePositionMinutes: row.site_position_minutes,
      effortUnit: row.effort_unit,
      workPhase: row.suggestion_rule === "sled-track" ? "sled" : row.effort_unit === "tile" || row.effort_unit === "m2" ? "floor" : "job",
      needsReview: row.status === "suggested" || Boolean(row.suggestion_rule),
    }),
  );
  return [...rows, ...bundled];
}

async function pricingConfig(): Promise<PricingConfig> {
  const admin = createAdminClient();
  if (!admin) {
    return {
      markupIndependent: 0.4,
      markupFranchisee: 0.4,
      markupTrade: 0.5,
      markupBigCorporate: 0.8,
      minJobCharge: null,
      marginFloorPct: null,
      largeOrderThreshold: 50000,
      variationRoundingHours: 0.5,
      sledTrackWidthM: null,
      sledBaseMinutes: 180,
      sledBaseLengthM: 10,
      sledExtraMinutesPerMetre: 6,
    };
  }
  const { data, error } = await admin.rpc("orbit_pricing_snapshot");
  if (error || !data) {
    throw new Error(messageFromError(error, "Could not read pricing settings."));
  }
  const row = data as Record<string, number | null>;
  return {
    markupIndependent: Number(row.markup_independent),
    markupFranchisee: Number(row.markup_franchisee),
    markupTrade: Number(row.markup_trade),
    markupBigCorporate: Number(row.markup_big_corporate),
    minJobCharge: row.min_job_charge == null ? null : Number(row.min_job_charge),
    marginFloorPct: row.margin_floor_pct == null ? null : Number(row.margin_floor_pct),
    largeOrderThreshold: Number(row.large_order_threshold),
    variationRoundingHours: Number(row.variation_rounding_hours),
    sledTrackWidthM: row.sled_track_width_m == null ? null : Number(row.sled_track_width_m),
    sledBaseMinutes: row.sled_base_minutes == null ? 180 : Number(row.sled_base_minutes),
    sledBaseLengthM: row.sled_base_length_m == null ? 10 : Number(row.sled_base_length_m),
    sledExtraMinutesPerMetre: row.sled_extra_minutes_per_m == null ? 6 : Number(row.sled_extra_minutes_per_m),
  };
}

function draftFromExtract(extracted: ExtractedQuote, source: QuoteDraft["source"]): QuoteDraft {
  const sum = Math.round(extracted.lines.reduce((total, line) => total + line.lineTotal, 0) * 100) / 100;
  const warnings = [...extracted.warnings];
  if (extracted.goodsNet != null && Math.abs(sum - extracted.goodsNet) > 0.009 && !warnings.some((warning) => warning.includes("Goods Net"))) {
    warnings.push(`Line totals sum to ${sum.toFixed(2)} but Goods Net is ${extracted.goodsNet.toFixed(2)}.`);
  }
  return {
    quoteNumber: extracted.quoteNumber ?? "",
    customerName: extracted.customerName ?? "",
    postcode: extracted.postcode ?? "",
    segment: "",
    customerReference: extracted.customerReference ?? "",
    lines: extracted.lines.map((line) => ({
      sku: line.sku,
      description: line.description || line.sku,
      qty: line.qty,
      category: "",
      lineTotal: line.lineTotal,
      unitWeightKg: null,
      productId: "",
    })),
    goodsNet: extracted.goodsNet,
    warnings,
    source,
    customerId: "",
    saleId: "",
    internalNote: "",
  };
}

function readDraft(formData: FormData): { draft: QuoteDraft; error?: string } {
  const segment = String(formData.get("segment") ?? "");
  const postcode = normaliseUkPostcode(String(formData.get("postcode") ?? ""));
  const descriptions = formData.getAll("lineDescription").map(String);
  const skus = formData.getAll("lineSku").map(String);
  const qtys = formData.getAll("lineQty").map((value) => Number(value));
  const categories = formData.getAll("lineCategory").map(String);
  const weights = formData.getAll("lineWeight").map((value) => {
    const text = String(value).trim();
    if (!text) return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  });
  const totals = formData.getAll("lineTotal").map((value) => {
    const text = String(value).trim();
    if (!text) return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  });
  if (!descriptions.length) return { draft: emptyDraft(), error: "Add at least one line." };
  if (!looksLikeUkPostcode(postcode)) return { draft: emptyDraft(), error: "Enter a UK postcode." };
  if (!SEGMENTS.includes(segment as Segment)) {
    return { draft: emptyDraft(), error: "Choose a customer segment before pricing. This quote has no segment." };
  }
  const lines: ReviewLine[] = descriptions.map((description, index) => ({
    sku: skus[index] ?? "",
    description: description.trim(),
    qty: qtys[index] ?? 0,
    category: categories[index] ?? "",
    lineTotal: totals[index] ?? null,
    unitWeightKg: weights[index] ?? null,
    productId: String(formData.getAll("lineProductId")[index] ?? ""),
    uom: String(formData.getAll("lineUom")[index] ?? "").trim() || null,
    tileLength: optionalMeasure(formData.getAll("lineTileLength")[index]),
    tileWidth: optionalMeasure(formData.getAll("lineTileWidth")[index]),
    dimensionUnit: String(formData.getAll("lineDimensionUnit")[index] ?? "").trim() || null,
    tilesPerPack: optionalMeasure(formData.getAll("lineTilesPerPack")[index]),
  }));
  if (lines.some((line) => !line.description || !Number.isFinite(line.qty) || line.qty <= 0)) {
    return { draft: emptyDraft(), error: "Each line needs a description and a quantity." };
  }
  const goodsText = String(formData.get("goodsNet") ?? "").trim();
  const goodsNet = goodsText ? Number(goodsText) : null;
  const warnings: string[] = [];
  if (goodsNet != null && Number.isFinite(goodsNet)) {
    const comparable = lines.filter((line) => line.lineTotal != null);
    const sum = Math.round(comparable.reduce((total, line) => total + (line.lineTotal ?? 0), 0) * 100) / 100;
    if (comparable.length === lines.length && Math.abs(sum - goodsNet) > 0.009) {
      warnings.push(`Line totals sum to ${sum.toFixed(2)} but Goods Net is ${goodsNet.toFixed(2)}.`);
    }
  }
  return {
    draft: {
      quoteNumber: String(formData.get("quoteNumber") ?? "").trim(),
      customerName: String(formData.get("customerName") ?? "").trim(),
      postcode,
      segment,
      customerReference: String(formData.get("customerReference") ?? "").trim(),
      lines,
      goodsNet: goodsNet != null && Number.isFinite(goodsNet) ? goodsNet : null,
      warnings,
      source: formData.get("source") === "pdf" ? "pdf" : formData.get("source") === "cin7" ? "cin7" : "fixture",
      customerId: String(formData.get("customerId") ?? "").trim(),
      saleId: String(formData.get("saleId") ?? "").trim(),
      internalNote: String(formData.get("internalNote") ?? "").trim(),
    },
  };
}

function optionalMeasure(value: FormDataEntryValue | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function emptyDraft(): QuoteDraft {
  return {
    quoteNumber: "",
    customerName: "",
    postcode: "",
    segment: "",
    customerReference: "",
    lines: [],
    goodsNet: null,
    warnings: [],
    source: "fixture",
    customerId: "",
    saleId: "",
    internalNote: "",
  };
}

async function withLiveCategories(lines: ReviewLine[]) {
  if (!cin7IsConnected()) return lines;
  const admin = createAdminClient();
  const accountId = process.env.CIN7_ACCOUNT_ID?.trim() ?? "";
  const applicationKey = process.env.CIN7_APPLICATION_KEY?.trim() ?? "";
  if (!admin || !accountId || !applicationKey) return lines;
  const skus = lines.map((line) => line.sku).filter(Boolean);
  const { data } = skus.length ? await admin.rpc("orbit_sku_effort_for_pricing", { p_skus: skus }) : { data: [] };
  const known = new Set((Array.isArray(data) ? data : []).map((row) => String((row as { sku?: string }).sku ?? "")));
  const filled = await fillMissingSkuCategories(lines, known, (productId) =>
    cin7Get({
      accountId,
      applicationKey,
      path: "product",
      query: { ID: productId, Limit: "1", IncludeDeprecated: "true" },
    }),
  );
  if (filled.found.length > 0) {
    await admin.rpc("orbit_sync_sku_effort", {
      p_rows: filled.found.map((hit) => ({
        sku: hit.sku,
        product_name: hit.name,
        cin7_category: hit.category,
        cin7_product_id: hit.productId,
      })),
    });
  }
  return filled.lines;
}

async function priceDraft(draft: QuoteDraft) {
  const context = await getOfficeContext();
  const profile = await getCurrentProfile();
  const showCost = seesInstallBreakdown({
    isOwner: context.is_owner,
    opsRole: context.ops_role,
    workspaceRole: profile?.workspace_role,
    operations: context.operations ?? profile?.levels?.operations,
  });
  const pricing = await pricingConfig();
  const lines = await withLiveCategories(draft.lines);
  draft.lines = lines;
  const floorFlags: string[] = [];
  const result = priceInstall({
    mode: "A",
    lines: lines.map((line) => {
      const floor = /floor/i.test(line.category);
      const measured = floor
        ? tilesFromSale({
            qty: line.qty,
            uom: line.uom ?? null,
            length: line.tileLength ?? null,
            width: line.tileWidth ?? null,
            dimensionUnit: line.dimensionUnit ?? null,
            tilesPerPack: line.tilesPerPack ?? null,
          })
        : null;
      if (measured?.assumed && measured.detail) floorFlags.push(`${line.sku || line.description}: ${measured.detail}`);
      return {
        sku: line.sku || null,
        productName: line.description,
        category: line.category || null,
        qty: line.qty,
        unitWeightKg: line.unitWeightKg,
        billableUnits: measured?.tiles ?? null,
        uom: line.uom ?? null,
        productWidth: line.tileWidth ?? null,
        dimensionUnit: line.dimensionUnit ?? null,
      };
    }),
    postcode: draft.postcode,
    segment: draft.segment as Segment,
    pricing,
    table: await effortTableFor(draft.lines),
    categoryDefaults: await categoryDefaults(),
  });
  const view: PricedQuote = {
    ...forSales(result),
    quoteNumber: draft.quoteNumber,
    customerName: draft.customerName,
    postcode: draft.postcode,
    showCost,
    requirements: showCost ? result.requirements : null,
    warnings: showCost ? draft.warnings : [],
    repSummary: result.cost != null && result.customerPrice != null
      ? {
          cost: result.cost,
          price: result.customerPrice,
          margin: result.customerPrice === 0 ? null : (result.customerPrice - result.cost) / result.customerPrice,
        }
      : null,
    priceNotes: {
      bigInstall: result.breakdown?.bigInstall ?? result.bigInstall,
      bigInstallTriggers: result.breakdown?.bigInstallTriggers ?? result.bigInstallTriggers,
      paymentGate: result.breakdown?.paymentGate ?? result.paymentGate,
      unset: result.breakdown?.unset ?? [],
      assumptions: (result.breakdown?.assumptions ?? []).filter((note) => !/crew\s*\d|build minutes|hq build|site position|person-hours|\blabour\b|assembly team/i.test(note) && note.length <= 240),
      flags: [...result.flags, ...floorFlags].filter((flag) => !/^Crew plan:/i.test(flag) && !/\b1\.30\b/.test(flag) && !/crew\s*\d|build minutes|hq build|site position|person-hours|\blabour\b|assembly team/i.test(flag)),
    },
  };
  if (showCost) {
    view.cost = result.cost;
    view.markup = result.markup;
    view.marginFloorPrice = result.marginFloorPrice;
    view.minJobChargeConfigured = result.minJobChargeConfigured;
    view.marginFloorConfigured = result.marginFloorConfigured;
    view.flags = [...result.flags, ...floorFlags];
    view.provisionalItems = result.provisionalItems;
    view.bigInstallTriggers = result.bigInstallTriggers;
    view.breakdown = result.breakdown;
    view.segment = result.segment;
  }
  return { result, view };
}

function quoteInputs(draft: QuoteDraft, result: { breakdown: unknown; flags: string[]; notice: string | null; customerPrice: number | null; segment: string | null; markup: number | null }) {
  return {
    postcode: draft.postcode,
    lines: draft.lines,
    profile: "best-case",
    source: draft.source,
    quoteNumber: draft.quoteNumber,
    saleId: draft.saleId,
    workings: {
      breakdown: result.breakdown,
      flags: result.flags,
      notice: result.notice,
      customerPrice: result.customerPrice,
      segment: result.segment,
      markup: result.markup,
    },
  };
}

function fixtureNumber(draft: QuoteDraft) {
  if (draft.quoteNumber.startsWith("FIXTURE-")) return draft.quoteNumber;
  const safe = draft.quoteNumber.replace(/[^A-Z0-9-]/gi, "") || "UPLOAD";
  return `FIXTURE-PDF-${safe}`;
}

function draftFromSale(quote: Cin7Quote, source: QuoteDraft["source"], rememberedSegment = ""): QuoteDraft {
  const warnings: string[] = [];
  if (quote.weightIgnored) warnings.push("A Cin7 product weight was not in kilograms, so it was left blank.");
  for (const flag of quote.moneyFlags ?? []) warnings.push(flag.message);
  if (source === "cin7" && !quote.postcode) warnings.push("No shipping postcode came back from Cin7. Enter the site postcode.");
  return {
    quoteNumber: quote.number,
    customerName: quote.customerName,
    postcode: quote.postcode ?? "",
    segment: quote.segment || rememberedSegment,
    customerReference: quote.customerRef,
    lines: quote.lines.map((line) => ({
      sku: line.sku ?? "",
      description: line.productName,
      qty: line.qty,
      category: line.cin7Category ?? line.category ?? "",
      lineTotal: line.lineNet ?? null,
      unitWeightKg: line.unitWeightKg ?? null,
      productId: line.productId ?? "",
      uom: line.uom ?? null,
      tileLength: line.length ?? null,
      tileWidth: line.width ?? null,
      dimensionUnit: line.dimensionUnit ?? null,
      tilesPerPack: line.tilesPerPack ?? null,
    })),
    goodsNet: null,
    warnings,
    source,
    customerId: quote.customerId ?? "",
    saleId: quote.id,
    internalNote: quote.usedQuoteLines ? "This sale has no order lines. Quote lines were used." : "",
  };
}

async function rememberedSegment(customerId: string) {
  if (!customerId) return "";
  const admin = createAdminClient();
  if (!admin) return "";
  const { data, error } = await admin.rpc("orbit_customer_segment", { p_cin7_id: customerId });
  if (error || typeof data !== "string") return "";
  return data;
}

async function fixturePause() {
  if (isFixtureMode()) await new Promise((resolve) => setTimeout(resolve, 1200));
}

export async function loadFixtureQuote(_state: ActionState, formData: FormData): Promise<ActionState & { draft?: QuoteDraft }> {
  await requireSalesUser();
  await fixturePause();
  const number = String(formData.get("quoteNumber") ?? "").trim();
  if (!number) return { ok: false, message: "Enter a quote number." };
  try {
    const connected = cin7IsConnected();
    const quote = await getCin7Client().getQuote(number);
    if (!quote) {
      return {
        ok: false,
        message: connected
          ? "No Cin7 sale has that order number."
          : "That order number was not found. Upload the quote PDF instead.",
      };
    }
    const remembered = connected ? await rememberedSegment(quote.customerId ?? "") : "";
    const draft = draftFromSale(quote, connected ? "cin7" : "fixture", remembered);
    return {
      ok: true,
      message: quote.segment ? "Quote loaded. Check the lines, then price." : "Quote loaded. Choose a segment before pricing.",
      draft,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not load that quote." };
  }
}

export async function parseUploadedQuote(_state: ActionState, formData: FormData): Promise<ActionState & { draft?: QuoteDraft }> {
  await requireSalesUser();
  const file = formData.get("quotePdf");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a quote PDF." };
  if (file.size > 8 * 1024 * 1024) return { ok: false, message: "That PDF is larger than 8 MB." };
  if (file.type && file.type !== "application/pdf") return { ok: false, message: "Upload a PDF." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!Buffer.from(bytes.subarray(0, 5)).toString("latin1").includes("%PDF")) {
    return { ok: false, message: "That file is not a PDF." };
  }
  const text = await pdfBytesToLayoutText(bytes);
  const extracted = cin7CoreExtractor.extract(text);
  if (!extracted.lines.length) {
    return { ok: false, message: "No quote lines were found in that PDF.", draft: draftFromExtract(extracted, "pdf") };
  }
  const draft = draftFromExtract(extracted, "pdf");
  draft.warnings.push("No segment is printed on a Cin7 Core quote. Choose one before pricing.");
  return {
    ok: true,
    message: draft.warnings.some((warning) => warning.includes("Goods Net"))
      ? "Quote read, with a totals warning. Choose a segment before pricing."
      : "Quote read. Choose a segment before pricing.",
    draft,
  };
}

export async function priceReviewedQuote(_state: ActionState, formData: FormData): Promise<ActionState & { quote?: PricedQuote }> {
  await requireSalesUser();
  await fixturePause();
  try {
    const { draft, error } = readDraft(formData);
    if (error) return { ok: false, message: error };
    const { result, view } = await priceDraft(draft);
    if (!result.blockedReason && draft.customerId && draft.segment) {
      const admin = createAdminClient();
      if (admin) {
        await admin.rpc("orbit_remember_segment", {
          p_cin7_id: draft.customerId,
          p_name: draft.customerName,
          p_segment: draft.segment,
        });
      }
    }
    const service = formData.get("alsoService") === "yes" ? await priceIngestedService(ingestDraft(draft)) : null;
    return {
      ok: !result.blockedReason,
      message: result.blockedReason ?? (service ? "Install and service prices are ready." : "Best-case price ready. Create the job when you want it booked."),
      quote: { ...view, service },
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not price that quote." };
  }
}

export async function priceSalesOrder(_state: ActionState, formData: FormData): Promise<ActionState & { quote?: PricedQuote; draft?: QuoteDraft }> {
  await requireSalesUser();
  await fixturePause();
  try {
    const file = formData.get("quotePdf");
    const loaded = file instanceof File && file.size > 0 ? await parseUploadedQuote(null, formData) : await loadFixtureQuote(null, formData);
    if (!loaded.draft) return loaded;
    const draft = loaded.draft;
    const chosen = String(formData.get("segment") ?? "");
    if (SEGMENTS.includes(chosen as Segment)) draft.segment = chosen;
    else if (!draft.segment) draft.segment = await rememberedSegment(draft.customerId);
    if (!SEGMENTS.includes(draft.segment as Segment)) {
      return { ok: false, message: "Choose a customer segment. Nothing is saved for this customer yet.", draft };
    }
    const { result, view } = await priceDraft(draft);
    if (!result.blockedReason && draft.customerId && draft.segment) {
      const admin = createAdminClient();
      if (admin) {
        await admin.rpc("orbit_remember_segment", {
          p_cin7_id: draft.customerId,
          p_name: draft.customerName,
          p_segment: draft.segment,
        });
      }
    }
    const service = formData.get("alsoService") === "yes" ? await priceIngestedService(ingestDraft(draft)) : null;
    return {
      ok: !result.blockedReason,
      message: result.blockedReason ?? (service ? "Install and service prices are ready." : "Install price ready."),
      quote: { ...view, service },
      draft,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not price that order." };
  }
}

export async function loadBookingWindow(jobId: string, month: string): Promise<{
  ok: boolean;
  message: string;
  installDays: number;
  canAllowWeekends: boolean;
  requirements: JobRequirements | null;
  resources: PoolResource[];
  busyByDay: Record<string, string[]>;
}> {
  await requireOperationsUser();
  const empty = { ok: false, message: "Could not read the calendar.", installDays: 1, canAllowWeekends: false, requirements: null, resources: [], busyByDay: {} };
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return { ...empty, message: "That job was not found." };
  if (!/^\d{4}-\d{2}$/.test(month)) return { ...empty, message: "Choose a month." };
  const context = await getOfficeContext();
  const supabase = await createClient();
  const requirement = await supabase.rpc("orbit_job_requirements", { p_job_id: jobId });
  if (requirement.error || !requirement.data) return { ...empty, message: "This job has no required resources yet." };
  const need = requirement.data as {
    installers: number;
    licensed_drivers: number;
    van_size: VanSize;
    van_count: number;
    stair_climber: boolean;
    install_days?: number;
  };
  const from = `${month}-01`;
  const to = addIsoDays(from, 70);
  const calendar = await supabase.rpc("orbit_calendar", { p_start: from, p_end: to });
  if (calendar.error || !calendar.data) return { ...empty, message: messageFromError(calendar.error, "Could not read the calendar.") };
  const data = calendar.data as {
    resources: { id: string; name: string; resource_type: string; has_licence: boolean; insured: boolean }[];
    reservations: { resource_id: string; job_id: string; day: string }[];
    unavailability: { resource_id: string; starts_on: string; ends_on: string }[];
  };
  const busyByDay: Record<string, string[]> = {};
  let cursor = from;
  while (cursor <= to) {
    const busy = new Set<string>();
    for (const row of data.reservations) {
      if (row.job_id !== jobId && String(row.day).startsWith(cursor)) busy.add(row.resource_id);
    }
    for (const row of data.unavailability) {
      if (cursor >= row.starts_on && cursor <= row.ends_on) busy.add(row.resource_id);
    }
    if (busy.size > 0) busyByDay[cursor] = [...busy];
    cursor = addIsoDays(cursor, 1);
  }
  return {
    ok: true,
    message: "",
    installDays: Math.max(1, Number(need.install_days ?? 1)),
    canAllowWeekends: canOverrideRequirements({ isOwner: context.is_owner }),
    requirements: {
      installers: need.installers,
      licensedDrivers: need.licensed_drivers,
      vanSize: need.van_size,
      vanCount: need.van_count,
      stairClimber: need.stair_climber,
    },
    resources: data.resources.map((resource) => ({
      id: resource.id,
      name: resource.name,
      resourceType: resource.resource_type,
      hasLicence: resource.has_licence,
      insured: resource.insured,
    })),
    busyByDay,
  };
}

export async function loadBookingDays(jobId: string): Promise<{ ok: boolean; message: string; days: { date: string; available: boolean }[] }> {
  await requireOperationsUser();
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return { ok: false, message: "That job was not found.", days: [] };
  const supabase = await createClient();
  const requirement = await supabase.rpc("orbit_job_requirements", { p_job_id: jobId });
  if (requirement.error || !requirement.data) return { ok: false, message: "This job has no required resources yet.", days: [] };
  const need = requirement.data as {
    installers: number;
    licensed_drivers: number;
    van_size: VanSize;
    van_count: number;
    stair_climber: boolean;
  };
  const start = new Date();
  const days = Array.from({ length: 21 }, (_, index) => new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10));
  const calendar = await supabase.rpc("orbit_calendar", { p_start: days[0], p_end: days[days.length - 1] });
  if (calendar.error || !calendar.data) return { ok: false, message: "Could not read the calendar.", days: [] };
  const data = calendar.data as {
    resources: { id: string; name: string; resource_type: string; has_licence: boolean; insured: boolean }[];
    reservations: { resource_id: string; job_id: string; day: string }[];
    unavailability: { resource_id: string; starts_on: string; ends_on: string }[];
  };
  const resources: PoolResource[] = data.resources.map((resource) => ({
    id: resource.id,
    name: resource.name,
    resourceType: resource.resource_type,
    hasLicence: resource.has_licence,
    insured: resource.insured,
  }));
  const priced = days.map((day) => {
    const busy = new Set<string>();
    for (const row of data.reservations) {
      if (row.job_id !== jobId && String(row.day).startsWith(day)) busy.add(row.resource_id);
    }
    for (const row of data.unavailability) {
      if (day >= row.starts_on && day <= row.ends_on) busy.add(row.resource_id);
    }
    const plan = planDay(
      {
        installers: need.installers,
        licensedDrivers: need.licensed_drivers,
        vanSize: need.van_size,
        vanCount: need.van_count,
        stairClimber: need.stair_climber,
      },
      resources,
      busy,
    );
    return { date: day, available: plan.selectable };
  });
  return { ok: true, message: "", days: priced };
}

export async function createPricedJob(_state: ActionState, formData: FormData): Promise<ActionState & { quote?: PricedQuote }> {
  await requireOperationsUser();
  try {
    const { draft, error } = readDraft(formData);
    if (error) return { ok: false, message: error };
    if (!draft.customerName) return { ok: false, message: "Enter the customer name." };
    const { result, view } = await priceDraft(draft);
    if (result.blockedReason || result.customerPrice == null || !result.requirements) {
      return { ok: false, message: result.blockedReason ?? "Price the quote before creating a job.", quote: view };
    }
    const admin = createAdminClient();
    if (!admin) return { ok: false, message: "Creating a job needs the service role key so resource counts stay on the server." };

    const supabase = await createClient();
    if (draft.source === "cin7") {
      const saved = await supabase.rpc("orbit_record_cin7_sale", {
        p_order_number: draft.quoteNumber,
        p_sale_id: draft.saleId,
        p_customer_id: draft.customerId,
        p_customer_name: draft.customerName,
        p_segment: draft.segment,
        p_postcode: draft.postcode,
        p_mode: "A",
        p_inputs: quoteInputs(draft, result),
        p_finality: result.finality,
        p_provisional: result.provisionalItems,
        p_internal_cost: result.cost,
        p_customer_price: result.customerPrice,
        p_markup: result.markup,
        p_lines: result.lines.map((line, index) => ({
          sku: draft.lines[index]?.sku ?? "",
          productName: line.productName,
          qty: line.qty,
          category: line.category,
          provisional: line.provisional,
        })),
        p_big_install: result.bigInstall,
        p_triggers: result.bigInstallTriggers,
      });
      if (saved.error) throw new Error(messageFromError(saved.error, "Could not create the job."));
      const jobId = (saved.data as { job_id?: string } | null)?.job_id;
      if (!jobId) throw new Error("The job was not created.");
      const stored = await admin.rpc("orbit_save_job_requirements", {
        p_job_id: jobId,
        p_installers: result.requirements.installers,
        p_licensed_drivers: result.requirements.licensedDrivers,
        p_van_size: result.requirements.vanSize,
        p_van_count: result.requirements.vanCount,
        p_stair_climber: result.requirements.stairClimber,
        p_install_days: Math.max(1, result.breakdown?.days ?? 1),
      });
      if (stored.error) throw new Error(messageFromError(stored.error, "Could not store required resources."));
      view.jobId = jobId;
      revalidatePath("/operations/jobs");
      return { ok: true, message: "Job created. You can book a day.", quote: view };
    }

    const number = fixtureNumber(draft);
    const reference = draft.customerReference.startsWith("FIXTURE-") ? draft.customerReference : `FIXTURE-PDF-${draft.customerReference || number}`;
    const saved = await supabase.rpc("orbit_record_fixture_quote", {
      p_cin7_number: number,
      p_customer_name: draft.customerName,
      p_customer_ref: reference,
      p_segment: draft.segment,
      p_customer_type: "",
      p_postcode: draft.postcode,
      p_mode: "A",
      p_inputs: quoteInputs(draft, result),
      p_finality: result.finality,
      p_provisional: result.provisionalItems,
      p_internal_cost: result.cost,
      p_customer_price: result.customerPrice,
      p_markup: result.markup,
      p_lines: result.lines.map((line) => ({
        productName: line.productName,
        qty: line.qty,
        category: line.category,
        provisional: line.provisional,
      })),
      p_big_install: result.bigInstall,
      p_triggers: result.bigInstallTriggers,
    });
    if (saved.error) throw new Error(messageFromError(saved.error, "Could not create the job."));
    const jobId = (saved.data as { job_id?: string } | null)?.job_id;
    if (!jobId) throw new Error("The job was not created.");
    const stored = await admin.rpc("orbit_save_job_requirements", {
      p_job_id: jobId,
      p_installers: result.requirements.installers,
      p_licensed_drivers: result.requirements.licensedDrivers,
      p_van_size: result.requirements.vanSize,
      p_van_count: result.requirements.vanCount,
      p_stair_climber: result.requirements.stairClimber,
      p_install_days: Math.max(1, result.breakdown?.days ?? 1),
    });
    if (stored.error) throw new Error(messageFromError(stored.error, "Could not store required resources."));
    view.jobId = jobId;
    revalidatePath("/operations/jobs");
    return { ok: true, message: "Job created. You can book a day.", quote: view };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not create that job." };
  }
}

export async function pencilJobDay(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireOperationsUser();
  const jobId = String(formData.get("jobId") ?? "");
  const day = String(formData.get("day") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, message: "Choose a day." };
  const context = await getOfficeContext();
  const canAllowWeekends = canOverrideRequirements({ isOwner: context.is_owner });
  const allowWeekends = formData.get("allowWeekends") === "yes";
  if (allowWeekends && !canAllowWeekends) {
    return { ok: false, message: "Weekend installs can only be pencilled by the owner." };
  }
  const supabase = await createClient();
  const requirement = await supabase.rpc("orbit_job_requirements", { p_job_id: jobId });
  if (requirement.error || !requirement.data) {
    return { ok: false, message: messageFromError(requirement.error, "This job has no required resources.") };
  }
  const need = requirement.data as {
    installers: number;
    licensed_drivers: number;
    van_size: VanSize;
    van_count: number;
    stair_climber: boolean;
    install_days?: number;
  };
  const installDays = Math.max(1, Number(need.install_days ?? 1));
  const dates = workingDaysFrom(day, installDays, allowWeekends && canAllowWeekends);
  const weekendError = weekendBookingError(dates, canAllowWeekends);
  if (weekendError) return { ok: false, message: weekendError };
  const calendar = await supabase.rpc("orbit_calendar", { p_start: dates[0], p_end: dates[dates.length - 1] });
  if (calendar.error || !calendar.data) {
    return { ok: false, message: messageFromError(calendar.error, "Could not read the calendar.") };
  }
  const data = calendar.data as {
    resources: { id: string; name: string; resource_type: string; has_licence: boolean; insured: boolean }[];
    reservations: { resource_id: string; job_id: string; day: string }[];
    unavailability: { resource_id: string; starts_on: string; ends_on: string }[];
  };
  const busyByDay: Record<string, string[]> = {};
  for (const date of dates) {
    const busy = new Set<string>();
    for (const row of data.reservations) {
      if (row.job_id !== jobId && String(row.day).startsWith(date)) busy.add(row.resource_id);
    }
    for (const row of data.unavailability) {
      if (date >= row.starts_on && date <= row.ends_on) busy.add(row.resource_id);
    }
    busyByDay[date] = [...busy];
  }
  const resources: PoolResource[] = data.resources.map((resource) => ({
    id: resource.id,
    name: resource.name,
    resourceType: resource.resource_type,
    hasLicence: resource.has_licence,
    insured: resource.insured,
  }));
  const requirements: JobRequirements = {
    installers: need.installers,
    licensedDrivers: need.licensed_drivers,
    vanSize: need.van_size,
    vanCount: need.van_count,
    stairClimber: need.stair_climber,
  };
  const plan = planRange(requirements, resources, busyByDay, day, installDays, allowWeekends && canAllowWeekends);
  if (!plan.selectable) {
    const blocked = plan.lines.find((line) => !line.available);
    return { ok: false, message: blocked ? `${blocked.label} is ${blocked.detail.toLowerCase()}.` : "That start day does not cover the install." };
  }
  const saved = await supabase.rpc("orbit_pencil_range", {
    p_job_id: jobId,
    p_start: day,
    p_allow_weekends: allowWeekends && canAllowWeekends,
    p_resource_ids: plan.chosenIds,
  });
  if (saved.error) return { ok: false, message: messageFromError(saved.error, "Could not pencil that day.") };
  revalidatePath(`/operations/jobs/${jobId}`);
  revalidatePath(`/operations/jobs/${jobId}/schedule`);
  revalidatePath("/operations/jobs");
  revalidatePath("/operations/calendar");
  return { ok: true, message: "Pencilled for office confirmation. This is not a firm booking." };
}

export async function overrideJobRequirements(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireOperationsUser();
  const context = await getOfficeContext();
  if (!canOverrideRequirements({ isOwner: context.is_owner })) {
    return { ok: false, message: "A sales rep cannot change required resources." };
  }
  const jobId = String(formData.get("jobId") ?? "");
  const vanSize = String(formData.get("vanSize") ?? "");
  if (vanSize !== "small" && vanSize !== "crafter") return { ok: false, message: "Choose a van size." };
  const supabase = await createClient();
  const saved = await supabase.rpc("orbit_override_requirements", {
    p_job_id: jobId,
    p_installers: Number(formData.get("installers")),
    p_licensed_drivers: Number(formData.get("licensedDrivers")),
    p_van_size: vanSize,
    p_van_count: Number(formData.get("vanCount")),
    p_stair_climber: formData.get("stairClimber") === "yes",
  });
  if (saved.error) return { ok: false, message: messageFromError(saved.error, "Could not override required resources.") };
  revalidatePath(`/operations/jobs/${jobId}`);
  revalidatePath(`/operations/jobs/${jobId}/schedule`);
  const row = saved.data as { conflict?: boolean; conflict_detail?: string | null } | null;
  return {
    ok: true,
    message: row?.conflict
      ? `Resources updated. The pencilled day no longer fits: ${row.conflict_detail ?? "check the calendar."}`
      : "Required resources updated and audited.",
  };
}
