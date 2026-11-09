"use server";

import { revalidatePath } from "next/cache";
import { cin7IsConnected, getCin7Client } from "@/lib/cin7/client";
import { fillMissingSkuCategories } from "@/lib/cin7/missing-product";
import { cin7Get } from "@/lib/cin7/transport";
import type { Cin7Quote } from "@/lib/cin7/types";
import { requireOperationsUser } from "@/lib/auth";
import { planDay, type PoolResource } from "@/lib/pulse/availability";
import type { JobRequirements, VanSize } from "@/lib/pulse/requirements";
import { canOverrideRequirements } from "@/lib/pulse/requirements";
import { loadBundledEffortTable } from "@/lib/pricer/effort-table";
import type { QuoteBreakdown } from "@/lib/pricer/breakdown";
import { effortRowForSku, forSales, priceInstall, type CategoryEffortDefault, type PricingConfig, type Segment } from "@/lib/pricer/engine";
import { looksLikeUkPostcode, normaliseUkPostcode } from "@/lib/quotes/postcode";
import { pdfBytesToLayoutText } from "@/lib/quotes/pdf-text";
import { cin7CoreExtractor } from "@/lib/quotes/parse-cin7-core";
import type { ExtractedQuote } from "@/lib/quotes/types";
import { getOfficeContext } from "@/features/operations/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { messageFromError } from "@/lib/errors";
import type { ActionState } from "@/lib/action-state";

const SEGMENTS = ["independent", "franchisee", "trade", "big_corporate"] as const;

export type ReviewLine = {
  sku: string;
  description: string;
  qty: number;
  category: string;
  lineTotal: number | null;
  unitWeightKg: number | null;
  productId: string;
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
  warnings: string[];
  breakdown?: QuoteBreakdown | null;
  segment?: string | null;
  cost?: number | null;
  markup?: number | null;
  marginFloorPrice?: number | null;
  minJobChargeConfigured?: boolean;
  marginFloorConfigured?: boolean;
  flags?: string[];
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
  const rows = (data as { sku: string; product_name: string; cin7_category: string | null; needs_assembly: boolean | null; crew: number | null; build_minutes: number | null }[]).map((row) =>
    effortRowForSku({
      sku: row.sku,
      productName: row.product_name,
      category: row.cin7_category,
      needsAssembly: row.needs_assembly,
      crew: row.crew,
      buildMinutes: row.build_minutes,
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
  const showCost = context.is_owner || context.ops_role === "install_lead" || context.ops_role === "admin_owner" || context.ops_role === "ops_manager";
  const pricing = await pricingConfig();
  const lines = await withLiveCategories(draft.lines);
  draft.lines = lines;
  const result = priceInstall({
    mode: "A",
    lines: lines.map((line) => ({
      sku: line.sku || null,
      productName: line.description,
      category: line.category || null,
      qty: line.qty,
      unitWeightKg: line.unitWeightKg,
    })),
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
    requirements: result.requirements,
    warnings: draft.warnings,
  };
  if (showCost) {
    view.cost = result.cost;
    view.markup = result.markup;
    view.marginFloorPrice = result.marginFloorPrice;
    view.minJobChargeConfigured = result.minJobChargeConfigured;
    view.marginFloorConfigured = result.marginFloorConfigured;
    view.flags = result.flags;
    view.provisionalItems = result.provisionalItems;
    view.bigInstallTriggers = result.bigInstallTriggers;
    view.breakdown = result.breakdown;
    view.segment = result.segment;
  }
  return { result, view };
}

function fixtureNumber(draft: QuoteDraft) {
  if (draft.quoteNumber.startsWith("FIXTURE-")) return draft.quoteNumber;
  const safe = draft.quoteNumber.replace(/[^A-Z0-9-]/gi, "") || "UPLOAD";
  return `FIXTURE-PDF-${safe}`;
}

function draftFromSale(quote: Cin7Quote, source: QuoteDraft["source"], rememberedSegment = ""): QuoteDraft {
  const warnings: string[] = [];
  if (quote.weightIgnored) warnings.push("A Cin7 product weight was not in kilograms, so it was left blank.");
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
      lineTotal: null,
      unitWeightKg: line.unitWeightKg ?? null,
      productId: line.productId ?? "",
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

export async function loadFixtureQuote(_state: ActionState, formData: FormData): Promise<ActionState & { draft?: QuoteDraft }> {
  await requireOperationsUser();
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
          : "That number is not in the fixture adapter. Cin7 not connected. Upload the quote PDF instead.",
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
  await requireOperationsUser();
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
  await requireOperationsUser();
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
    return {
      ok: !result.blockedReason,
      message: result.blockedReason ?? "Best-case price ready. Create the job when you want it booked.",
      quote: view,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not price that quote." };
  }
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
        p_inputs: { postcode: draft.postcode, lines: draft.lines, profile: "best-case", source: draft.source, quoteNumber: draft.quoteNumber, saleId: draft.saleId },
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
      });
      if (stored.error) throw new Error(messageFromError(stored.error, "Could not store required resources."));
      view.jobId = jobId;
      revalidatePath("/operations/jobs");
      return { ok: true, message: "Job created from the Cin7 sale. Required resources are locked for the sales rep.", quote: view };
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
      p_inputs: { postcode: draft.postcode, lines: draft.lines, profile: "best-case", source: draft.source, quoteNumber: draft.quoteNumber },
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
    });
    if (stored.error) throw new Error(messageFromError(stored.error, "Could not store required resources."));
    view.jobId = jobId;
    revalidatePath("/operations/jobs");
    return { ok: true, message: "Job created. Required resources are locked for the sales rep.", quote: view };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not create that job." };
  }
}

export async function pencilJobDay(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireOperationsUser();
  const jobId = String(formData.get("jobId") ?? "");
  const day = String(formData.get("day") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, message: "Choose a day." };
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
  };
  const calendar = await supabase.rpc("orbit_calendar", { p_start: day, p_end: day });
  if (calendar.error || !calendar.data) {
    return { ok: false, message: messageFromError(calendar.error, "Could not read the calendar.") };
  }
  const data = calendar.data as {
    resources: { id: string; name: string; resource_type: string; has_licence: boolean; insured: boolean }[];
    reservations: { resource_id: string; job_id: string }[];
    unavailability: { resource_id: string }[];
  };
  const busy = new Set<string>();
  for (const row of data.reservations) {
    if (row.job_id !== jobId) busy.add(row.resource_id);
  }
  for (const row of data.unavailability) busy.add(row.resource_id);
  const resources: PoolResource[] = data.resources.map((resource) => ({
    id: resource.id,
    name: resource.name,
    resourceType: resource.resource_type,
    hasLicence: resource.has_licence,
    insured: resource.insured,
  }));
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
  if (!plan.selectable) return { ok: false, message: plan.summary };
  const saved = await supabase.rpc("orbit_pencil_day", {
    p_job_id: jobId,
    p_day: day,
    p_resource_ids: plan.chosenIds,
  });
  if (saved.error) return { ok: false, message: messageFromError(saved.error, "Could not pencil that day.") };
  revalidatePath(`/operations/jobs/${jobId}`);
  revalidatePath(`/operations/jobs/${jobId}/schedule`);
  return { ok: true, message: "Pencilled for office confirmation. This is not a firm booking." };
}

export async function overrideJobRequirements(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireOperationsUser();
  const context = await getOfficeContext();
  if (!canOverrideRequirements({ opsRole: context.ops_role, isOwner: context.is_owner })) {
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
