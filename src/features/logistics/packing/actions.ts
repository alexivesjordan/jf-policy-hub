"use server";

import { revalidatePath } from "next/cache";
import { requireLogisticsApi } from "@/features/logistics/commercial-invoice/access";
import { syncCin7Products } from "@/lib/cin7/sync-products";
import { messageFromError } from "@/lib/errors";
import { packagesFromCsv } from "@/lib/packing/csv";
import type { ActionState } from "@/lib/action-state";
import { createClient } from "@/lib/supabase/server";

async function logisticsClient() {
  const gate = await requireLogisticsApi();
  if (gate.error || !gate.profile) throw new Error(gate.error ?? "Sign in required.");
  return createClient();
}

export async function syncPackagingFromCin7(): Promise<ActionState> {
  try {
    const supabase = await logisticsClient();
    const result = await syncCin7Products({
      async upsert(rows) {
        const { error } = await supabase.rpc("logistics_seed_sku_packages", { p_rows: rows });
        if (error) throw new Error(messageFromError(error, "Could not save the product sync."));
      },
    });
    revalidatePath("/logistics/packaging");
    return { ok: result.ok, message: result.message };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not sync products." };
  }
}

export async function importSkuPackages(_state: ActionState, formData: FormData): Promise<ActionState> {
  void _state;
  try {
    const supabase = await logisticsClient();
    const file = formData.get("csv");
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a CSV file." };
    if (file.size > 2 * 1024 * 1024) return { ok: false, message: "That CSV is larger than 2 MB." };
    const parsed = packagesFromCsv(await file.text());
    if (parsed.error) return { ok: false, message: parsed.error };
    const { data, error } = await supabase.rpc("logistics_import_sku_packages", { p_rows: parsed.rows });
    if (error) throw new Error(messageFromError(error, "Could not import that CSV."));
    revalidatePath("/logistics/packaging");
    return { ok: true, message: `Imported ${data ?? parsed.rows.length} packages.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not import that CSV." };
  }
}

export async function saveSkuPackage(input: {
  id: number;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  weightKg: string;
  stackable: boolean;
  maxStack: string;
  canBeOnSide: boolean;
  palletOnly: boolean;
}): Promise<ActionState> {
  try {
    const supabase = await logisticsClient();
    const lengthCm = whole(input.lengthCm, "Length");
    const widthCm = whole(input.widthCm, "Width");
    const heightCm = whole(input.heightCm, "Height");
    const weightKg = weight(input.weightKg);
    const maxStack = whole(input.maxStack, "Max stack", 1, 20);
    const { error } = await supabase.schema("logistics").from("sku_packages").update({
      length_cm: lengthCm,
      width_cm: widthCm,
      height_cm: heightCm,
      gross_weight_kg: weightKg,
      stackable: input.stackable,
      max_stack: maxStack,
      can_be_on_side: input.canBeOnSide,
      ships_on_pallet_only: input.palletOnly,
      updated_at: new Date().toISOString(),
    }).eq("id", input.id);
    if (error) throw new Error(messageFromError(error, "Could not save that package."));
    revalidatePath("/logistics/packaging");
    return { ok: true, message: "Saved." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not save that package." };
  }
}

export async function addSkuPackage(sku: string): Promise<ActionState> {
  try {
    const supabase = await logisticsClient();
    const existing = await supabase.schema("logistics").from("sku_packages")
      .select("package_no, product_name, cin7_category, cin7_product_id")
      .eq("sku", sku);
    if (existing.error) throw new Error(messageFromError(existing.error, "Could not add a box."));
    const rows = (existing.data ?? []) as { package_no: number; product_name: string; cin7_category: string | null; cin7_product_id: string | null }[];
    if (!rows.length) return { ok: false, message: "That SKU is not in the catalogue." };
    const next = Math.max(...rows.map((row) => Number(row.package_no))) + 1;
    if (next > 20) return { ok: false, message: "A SKU can have 20 boxes." };
    const source = rows[0]!;
    const { error } = await supabase.schema("logistics").from("sku_packages").insert({
      sku,
      product_name: source.product_name,
      cin7_category: source.cin7_category,
      cin7_product_id: source.cin7_product_id,
      package_no: next,
    });
    if (error) throw new Error(messageFromError(error, "Could not add a box."));
    revalidatePath("/logistics/packaging");
    return { ok: true, message: "Added." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not add a box." };
  }
}

export async function deleteSkuPackage(id: number): Promise<ActionState> {
  try {
    const supabase = await logisticsClient();
    const current = await supabase.schema("logistics").from("sku_packages").select("id, sku, package_no").eq("id", id).maybeSingle();
    if (current.error || !current.data) return { ok: false, message: "That box is no longer there." };
    const row = current.data as { sku: string; package_no: number };
    const siblings = await supabase.schema("logistics").from("sku_packages").select("id").eq("sku", row.sku);
    if ((siblings.data ?? []).length < 2) return { ok: false, message: "The catalogue row stays." };
    const { error } = await supabase.schema("logistics").from("sku_packages").delete().eq("id", id);
    if (error) throw new Error(messageFromError(error, "Could not remove that box."));
    revalidatePath("/logistics/packaging");
    return { ok: true, message: "Removed." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not remove that box." };
  }
}

export async function savePackingDefaults(input: {
  palletCode: string;
  maxHeightCm: number;
  maxWeightKg: number;
  maxParcelWeightKg: number;
  maxParcelLengthCm: number;
}): Promise<ActionState> {
  try {
    const supabase = await logisticsClient();
    if (!Number.isInteger(input.maxHeightCm) || input.maxHeightCm < 50 || input.maxHeightCm > 300) {
      return { ok: false, message: "Max height is invalid." };
    }
    if (!(input.maxWeightKg >= 50) || input.maxWeightKg > 2000) return { ok: false, message: "Max gross weight is invalid." };
    if (!(input.maxParcelWeightKg >= 0.1) || input.maxParcelWeightKg > 100) return { ok: false, message: "Parcel weight is invalid." };
    if (!Number.isInteger(input.maxParcelLengthCm) || input.maxParcelLengthCm < 10 || input.maxParcelLengthCm > 300) {
      return { ok: false, message: "Parcel length is invalid." };
    }
    const { error } = await supabase.schema("logistics").from("packing_settings").update({
      pallet_code: input.palletCode,
      max_pallet_height_cm: input.maxHeightCm,
      max_pallet_weight_kg: input.maxWeightKg,
      max_parcel_weight_kg: input.maxParcelWeightKg,
      max_parcel_length_cm: input.maxParcelLengthCm,
      updated_at: new Date().toISOString(),
    }).eq("id", "default");
    if (error) throw new Error(messageFromError(error, "Could not save defaults."));
    revalidatePath("/logistics/pack-estimate");
    return { ok: true, message: "Saved." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not save defaults." };
  }
}

function whole(value: string, label: string, min = 1, max = 1000): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[0-9]+$/.test(trimmed)) throw new Error(`${label} must be a whole number.`);
  const parsed = Number(trimmed);
  if (parsed < min || parsed > max) throw new Error(`${label} must be from ${min} to ${max}.`);
  return parsed;
}

function weight(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[0-9]+(\.[0-9])?$/.test(trimmed)) throw new Error("Weight must have at most one decimal.");
  const parsed = Number(trimmed);
  if (!(parsed > 0) || parsed > 2000) throw new Error("Weight must be greater than 0 and at most 2000 kg.");
  return parsed;
}
