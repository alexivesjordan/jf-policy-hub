import "server-only";

import type { DimensionRow } from "@/features/logistics/commercial-invoice/retrieve";
import { messageFromError } from "@/lib/errors";
import type { InvoiceDimensionRow, LoadSpace, PackageSpec } from "@/lib/packing/types";
import { createClient } from "@/lib/supabase/server";
import type { SkuPackageRow } from "./row";

export type { SkuPackageRow } from "./row";

export type PackingCatalogue = {
  pallets: (LoadSpace & { name: string })[];
  defaults: {
    palletCode: string;
    maxHeightCm: number;
    maxWeightKg: number;
    maxParcelWeightKg: number;
    maxParcelLengthCm: number;
  } | null;
};

const PACKAGE_COLUMNS = "sku, product_name, package_no, length_cm, width_cm, height_cm, gross_weight_kg, stackable, max_stack, can_be_on_side, ships_on_pallet_only";

export async function listSkuPackages(filters: { search: string; missing: boolean; offset: number }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("logistics_list_sku_packages", {
    p_search: filters.search,
    p_missing: filters.missing,
    p_limit: 50,
    p_offset: filters.offset,
  });
  if (error) throw new Error(messageFromError(error, "Could not load packaging."));
  const body = data as { total?: number; rows?: SkuPackageRow[] } | null;
  return {
    total: Number(body?.total ?? 0),
    rows: Array.isArray(body?.rows) ? body.rows.map(normaliseRow) : [],
  };
}

export async function loadPackingCatalogue(): Promise<PackingCatalogue> {
  const supabase = await createClient();
  const [spaces, settings] = await Promise.all([
    supabase.schema("logistics").from("load_spaces")
      .select("code, kind, name, length_cm, width_cm, height_cm, max_weight_kg, tare_kg, deck_cm")
      .eq("active", true)
      .eq("kind", "pallet")
      .order("sort_order"),
    supabase.schema("logistics").from("packing_settings")
      .select("pallet_code, max_pallet_height_cm, max_pallet_weight_kg, max_parcel_weight_kg, max_parcel_length_cm")
      .eq("id", "default")
      .maybeSingle(),
  ]);
  if (spaces.error) throw new Error(messageFromError(spaces.error, "Could not load pallet sizes."));
  if (settings.error) throw new Error(messageFromError(settings.error, "Could not load packing defaults."));
  const pallets = ((spaces.data ?? []) as Record<string, unknown>[]).flatMap((row) => {
    const space = spaceFromRow(row);
    if (!space || space.kind !== "pallet") return [];
    return [{ ...space, name: String(row.name ?? space.code) }];
  });
  const row = settings.data as Record<string, unknown> | null;
  return {
    pallets,
    defaults: row ? {
      palletCode: String(row.pallet_code ?? ""),
      maxHeightCm: num(row.max_pallet_height_cm) ?? 180,
      maxWeightKg: num(row.max_pallet_weight_kg) ?? 1000,
      maxParcelWeightKg: num(row.max_parcel_weight_kg) ?? 30,
      maxParcelLengthCm: num(row.max_parcel_length_cm) ?? 120,
    } : null,
  };
}

export async function loadPackagesForSkus(skus: string[]): Promise<PackageSpec[]> {
  const wanted = [...new Set(skus.map((sku) => sku.trim()).filter(Boolean))];
  if (!wanted.length) return [];
  const supabase = await createClient();
  const result = await supabase.schema("logistics").from("sku_packages").select(PACKAGE_COLUMNS).in("sku", wanted);
  if (result.error) throw new Error(messageFromError(result.error, "Could not load packaging."));
  const rows = (result.data ?? []) as Record<string, unknown>[];
  return rows.filter((row) => wanted.includes(String(row.sku ?? ""))).map(packageFromRow);
}

export async function searchPackagingSkus(query: string) {
  const safe = query.trim().replace(/[%_,().\\]/g, "").slice(0, 80);
  if (safe.length < 2) return [];
  const supabase = await createClient();
  const result = await supabase.schema("logistics").from("sku_packages")
    .select("sku, product_name")
    .or(`sku.ilike.%${safe}%,product_name.ilike.%${safe}%`)
    .order("sku")
    .limit(24);
  if (result.error) throw new Error(messageFromError(result.error, "Could not search packaging."));
  const needle = safe.toLowerCase();
  const seen = new Set<string>();
  const matches: { sku: string; name: string }[] = [];
  for (const row of (result.data ?? []) as { sku?: string; product_name?: string }[]) {
    const sku = row.sku?.trim() ?? "";
    const name = row.product_name?.trim() || sku;
    if (!sku || seen.has(sku)) continue;
    if (!sku.toLowerCase().includes(needle) && !name.toLowerCase().includes(needle)) continue;
    seen.add(sku);
    matches.push({ sku, name });
    if (matches.length >= 8) break;
  }
  return matches;
}

export async function loadPackPrefill(id: string | undefined): Promise<{ orderNumbers: string; rows: DimensionRow[] } | null> {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const result = await supabase.schema("logistics").from("pack_estimates")
    .select("order_numbers, result")
    .eq("id", id)
    .maybeSingle();
  if (result.error || !result.data) return null;
  const row = result.data as { order_numbers?: unknown; result?: unknown };
  const rows = invoiceRows(row.result);
  if (!rows) return null;
  return {
    orderNumbers: typeof row.order_numbers === "string" ? row.order_numbers : "",
    rows,
  };
}

export async function loadLoadSpace(code: string): Promise<LoadSpace | null> {
  const supabase = await createClient();
  const result = await supabase.schema("logistics").from("load_spaces")
    .select("code, kind, name, length_cm, width_cm, height_cm, max_weight_kg, tare_kg, deck_cm")
    .eq("code", code)
    .eq("active", true)
    .maybeSingle();
  if (result.error) throw new Error(messageFromError(result.error, "Could not load that pallet."));
  return result.data ? spaceFromRow(result.data as Record<string, unknown>) : null;
}

function normaliseRow(row: SkuPackageRow): SkuPackageRow {
  return {
    ...row,
    id: Number(row.id),
    package_no: Number(row.package_no),
    length_cm: num(row.length_cm),
    width_cm: num(row.width_cm),
    height_cm: num(row.height_cm),
    gross_weight_kg: num(row.gross_weight_kg),
    max_stack: num(row.max_stack),
    stackable: Boolean(row.stackable),
    can_be_on_side: Boolean(row.can_be_on_side),
    ships_on_pallet_only: Boolean(row.ships_on_pallet_only),
  };
}

function packageFromRow(row: Record<string, unknown>): PackageSpec {
  return {
    sku: String(row.sku ?? ""),
    name: String(row.product_name ?? row.sku ?? ""),
    packageNo: num(row.package_no) ?? 1,
    lengthCm: num(row.length_cm),
    widthCm: num(row.width_cm),
    heightCm: num(row.height_cm),
    weightKg: num(row.gross_weight_kg),
    stackable: Boolean(row.stackable),
    maxStack: num(row.max_stack),
    canBeOnSide: Boolean(row.can_be_on_side),
    palletOnly: Boolean(row.ships_on_pallet_only),
  };
}

function spaceFromRow(row: Record<string, unknown>): LoadSpace | null {
  const kind = row.kind === "container" || row.kind === "vehicle" || row.kind === "pallet" ? row.kind : null;
  const lengthCm = num(row.length_cm);
  const widthCm = num(row.width_cm);
  const heightCm = num(row.height_cm);
  const maxWeightKg = num(row.max_weight_kg);
  const deckCm = num(row.deck_cm) ?? 0;
  const tareKg = num(row.tare_kg) ?? 0;
  if (!kind || lengthCm == null || widthCm == null || heightCm == null || maxWeightKg == null) return null;
  return { code: String(row.code), kind, lengthCm, widthCm, heightCm, maxWeightKg, deckCm, tareKg };
}

function invoiceRows(result: unknown): DimensionRow[] | null {
  if (!result || typeof result !== "object" || !("invoiceRows" in result)) return null;
  const rows = (result as { invoiceRows: unknown }).invoiceRows;
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 30) return null;
  const mapped: DimensionRow[] = [];
  for (const item of rows) {
    if (!isInvoiceRow(item)) return null;
    mapped.push({
      kind: item.kind,
      lengthCm: String(item.lengthCm),
      widthCm: String(item.widthCm),
      depthCm: String(item.depthCm),
      weightKg: String(item.weightKg),
    });
  }
  return mapped;
}

function isInvoiceRow(value: unknown): value is InvoiceDimensionRow {
  if (!value || typeof value !== "object") return false;
  const row = value as InvoiceDimensionRow;
  return (row.kind === "parcel" || row.kind === "pallet")
    && [row.lengthCm, row.widthCm, row.depthCm].every((item) => Number.isInteger(item) && item >= 1 && item <= 1000)
    && typeof row.weightKg === "number"
    && row.weightKg > 0
    && row.weightKg <= 2000;
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
