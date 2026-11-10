"use server";

import { revalidatePath } from "next/cache";
import { getCin7Client } from "@/lib/cin7/client";
import { requireOperationsUser } from "@/lib/auth";
import { loadBundledEffortTable } from "@/lib/pricer/effort-table";
import { forSales, priceInstall, type PricingConfig } from "@/lib/pricer/engine";
import { getOfficeContext } from "@/features/operations/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { messageFromError } from "@/lib/errors";
import type { ActionState } from "@/lib/action-state";

export type PricedQuote = ReturnType<typeof forSales> & {
  quoteNumber: string;
  customerName: string;
  postcode: string;
  jobId?: string;
  showCost: boolean;
  cost?: number | null;
  markup?: number | null;
  marginFloorPrice?: number | null;
  minJobChargeConfigured?: boolean;
  marginFloorConfigured?: boolean;
  flags?: string[];
  provisionalItems?: string[];
  bigInstallTriggers?: string[];
};

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

export async function priceFixtureQuote(_state: ActionState, formData: FormData): Promise<ActionState & { quote?: PricedQuote }> {
  await requireOperationsUser();
  try {
    const quoteId = String(formData.get("quoteId") ?? "");
    const postcode = String(formData.get("postcode") ?? "").trim().toUpperCase();
    if (!/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/.test(postcode)) {
      return { ok: false, message: "Enter a UK postcode." };
    }
    const quote = await getCin7Client().getQuote(quoteId);
    if (!quote) return { ok: false, message: "That fixture quote could not be found." };

    const context = await getOfficeContext();
    const showCost = context.is_owner || context.ops_role === "install_lead" || context.ops_role === "admin_owner";
    const pricing = await pricingConfig();
    const result = priceInstall({
      mode: "A",
      lines: quote.lines,
      postcode,
      segment: quote.segment,
      customerType: quote.customerType,
      pricing,
      table: loadBundledEffortTable(),
    });

    let jobId: string | undefined;
    if (!result.blockedReason && result.customerPrice != null) {
      const supabase = await createClient();
      const saved = await supabase.rpc("orbit_record_fixture_quote", {
        p_cin7_number: quote.number,
        p_customer_name: quote.customerName,
        p_customer_ref: quote.customerRef,
        p_segment: quote.segment ?? "",
        p_customer_type: quote.customerType ?? "",
        p_postcode: postcode,
        p_mode: "A",
        p_inputs: { postcode, lines: quote.lines, profile: "best-case" },
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
      if (saved.error) throw new Error(messageFromError(saved.error, "Could not save the quote."));
      jobId = (saved.data as { job_id?: string } | null)?.job_id;
    }

    const shared = forSales(result);
    const quoteView: PricedQuote = {
      ...shared,
      quoteNumber: quote.number,
      customerName: quote.customerName,
      postcode,
      jobId,
      showCost,
    };
    if (showCost) {
      quoteView.cost = result.cost;
      quoteView.markup = result.markup;
      quoteView.marginFloorPrice = result.marginFloorPrice;
      quoteView.minJobChargeConfigured = result.minJobChargeConfigured;
      quoteView.marginFloorConfigured = result.marginFloorConfigured;
      quoteView.flags = result.flags;
      quoteView.provisionalItems = result.provisionalItems;
      quoteView.bigInstallTriggers = result.bigInstallTriggers;
    }
    revalidatePath("/operations/jobs");
    return {
      ok: !result.blockedReason,
      message: result.blockedReason ?? "Best-case price saved.",
      quote: quoteView,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not price that quote." };
  }
}
