import "server-only";

import { messageFromError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type {
  GateOverrideRow,
  JobDetail,
  JobSummary,
  OfficeContext,
  PulseNotification,
  PulseTask,
  PricingSettings,
  StoredRequirements,
  TermsVersion,
} from "@/features/operations/types";

async function rpc<T>(fn: string, args?: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(messageFromError(error, "Could not load Operations."));
  return data as T;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function getOfficeContext() {
  return rpc<OfficeContext>("orbit_office_context");
}

export async function listJobs() {
  return asArray<JobSummary>(await rpc("orbit_list_jobs"));
}

export async function getJob(id: string) {
  const row = await rpc<JobDetail | null>("orbit_get_job", { p_job_id: id });
  return row;
}

export async function listCategoryEffortDefaults() {
  return asArray<{
    version: number;
    category: string;
    build_crew: number;
    build_minutes: number;
    note: string;
  }>(await rpc("orbit_category_effort_defaults"));
}

export async function readOwnerSettings() {
  const data = await rpc<{
    settings: unknown;
    pricing_settings: PricingSettings | null;
  }>("orbit_read_settings");
  return data.pricing_settings;
}

export async function readTerms() {
  return rpc<TermsVersion | null>("orbit_read_terms");
}

export async function listGateOverrides() {
  return asArray<GateOverrideRow>(await rpc("orbit_list_gate_overrides"));
}

export async function getJobRequirements(id: string) {
  return rpc<StoredRequirements | null>("orbit_job_requirements", { p_job_id: id });
}

export async function listPulseNotifications(unreadOnly = false) {
  return asArray<PulseNotification>(
    await rpc("orbit_list_notifications", { p_unread_only: unreadOnly }),
  );
}

export async function listPulseTasks() {
  return asArray<PulseTask>(await rpc("orbit_list_tasks"));
}

export type Cin7CategoryDefault = {
  category: string;
  needs_assembly: boolean | null;
  crew: number | null;
  build_minutes: number | null;
  effort_unit?: "each" | "tile" | "m2" | null;
  build_location?: "hq" | "site" | null;
  hq_build_minutes?: number | null;
  hq_build_crew?: number | null;
  site_position_minutes?: number | null;
  status: string;
  notes: string | null;
};

export type SkuEffortRow = {
  sku: string;
  product_name: string;
  cin7_category: string | null;
  cin7_uom?: string | null;
  needs_assembly: boolean | null;
  crew: number | null;
  build_minutes: number | null;
  effort_unit?: "each" | "tile" | "m2" | null;
  build_location?: "hq" | "site" | null;
  hq_build_minutes?: number | null;
  hq_build_crew?: number | null;
  site_position_minutes?: number | null;
  status: string;
  notes: string | null;
  suggestion_rule?: string | null;
};

export async function listCin7CategoryDefaults() {
  return asArray<Cin7CategoryDefault>(await rpc("orbit_cin7_category_defaults"));
}

export type CategoryGap = {
  category: string;
  sku_count: number;
};

export async function listCategoriesWithoutDefault() {
  return asArray<CategoryGap>(await rpc("orbit_categories_without_default"));
}

export async function listSkuEffort(filters: {
  search?: string;
  category?: string;
  status?: string;
  needsAssembly?: string;
  offset?: number;
}) {
  return rpc<{
    review_count: number;
    name_rule_count?: number;
    total: number;
    categories: string[];
    rows: SkuEffortRow[];
  }>("orbit_list_sku_effort", {
    p_search: filters.search ?? "",
    p_category: filters.category ?? "",
    p_status: filters.status ?? "",
    p_needs_assembly: filters.needsAssembly ?? "",
    p_limit: 50,
    p_offset: filters.offset ?? 0,
  });
}
