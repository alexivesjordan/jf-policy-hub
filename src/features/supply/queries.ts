import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function supplyRpc<T>(fn: string, args?: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (/cannot see/i.test(error.message)) redirect("/no-access");
    throw new Error(error.message.replace(/^app:\s*/, ""));
  }
  return data as T;
}

export type SupplyOverview = {
  lastSync: string | null;
  zeroStock: number;
  belowReorder: number;
  overstock: number;
  alerts: { sku: string; reason: string; onHand: number; available: number; onOrder: number; zeroStock: boolean; belowReorder: boolean }[];
};

export type ReorderGroup = {
  supplierId: string | null;
  supplierName: string;
  currency: string;
  rows: { id: string; sku: string; available: number; onOrder: number; reorderPoint: number; suggestedQty: number; reason: string }[];
};

export function loadOverview() {
  return supplyRpc<SupplyOverview>("supply_overview");
}

export function loadReorder() {
  return supplyRpc<{ runId: string | null; canEdit: boolean; groups: ReorderGroup[] }>("supply_reorder");
}

export function loadSkus(search: string) {
  return supplyRpc<{ sku: string; label: string | null; supplier: string | null; exclude: boolean; onHand: number | null; available: number | null }[]>("supply_skus", { p_search: search, p_offset: 0, p_limit: 50 });
}

export function loadSku(sku: string) {
  return supplyRpc<{
    sku: string;
    label: string | null;
    supplierId: string | null;
    supplierName: string | null;
    leadTimeDays: number | null;
    leadTimeSource: string | null;
    moq: number | null;
    orderMultiple: number | null;
    safetyDays: number | null;
    exclude: boolean;
    onHand: number | null;
    available: number | null;
    onOrder: number | null;
    capturedAt: string | null;
    demand: { month: string; qty: number; source: "cin7" | "orderwise"; orderCount: number }[];
    forecast: { month: string; qty: number; method: string }[];
  }>("supply_sku", { p_sku: sku });
}

export function loadSuppliers() {
  return supplyRpc<{ canEdit: boolean; rows: { id: string; name: string; leadTimeDays: number | null; moq: number | null; orderMultiple: number | null; currency: string; active: boolean; source: string }[] }>("supply_suppliers");
}

export function loadMappings() {
  return supplyRpc<{
    canEdit: boolean;
    canAdmin: boolean;
    mappings: { id: string; name: string; kind: string; columns: Record<string, string>; dateFormat: string; delimiter: string }[];
    batches: { id: string; mappingName: string | null; kind: string | null; filePath: string | null; status: string; rowsRead: number; rowsLoaded: number; rowsUnmatched: number; createdAt: string }[];
  }>("supply_mappings");
}

export function loadSettings() {
  return supplyRpc<{
    serviceLevel: number;
    reviewDays: number;
    defaultLeadTimeDays: number;
    forecastMonths: number;
    zeroStockAlert: boolean;
    stockLocation: string | null;
    smaWindow: number;
    crostonAlpha: number;
    initialLookbackMonths: number;
    canAdmin: boolean;
    lastSync: string | null;
    lastSyncError: string | null;
    phase: string;
  }>("supply_settings");
}

export function londonTime(value: string | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
