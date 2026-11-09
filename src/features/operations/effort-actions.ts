"use server";

import { revalidatePath } from "next/cache";
import { requireOperationsUser } from "@/lib/auth";
import { syncCin7Products, type SkuSyncRow } from "@/lib/cin7/sync-products";
import { messageFromError } from "@/lib/errors";
import { parseCsv } from "@/lib/pricer/effort-table";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/action-state";

async function ownerClient() {
  await requireOperationsUser();
  return createClient();
}

export async function syncProductsFromCin7(_state: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const supabase = await ownerClient();
    const result = await syncCin7Products({
      async upsert(rows: SkuSyncRow[]) {
        const { error } = await supabase.rpc("orbit_sync_sku_effort", { p_rows: rows });
        if (error) throw new Error(messageFromError(error, "Could not save the product sync."));
      },
    });
    revalidatePath("/operations/settings");
    return { ok: result.ok, message: result.message };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not sync products." };
  }
}

export async function saveCin7CategoryDefaults(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const supabase = await ownerClient();
    const categories = formData.getAll("category").map(String);
    const assembly = formData.getAll("needsAssembly").map(String);
    const crews = formData.getAll("crew").map(String);
    const minutes = formData.getAll("minutes").map(String);
    const notes = formData.getAll("notes").map(String);
    const locations = formData.getAll("buildLocation").map(String);
    const hqMinutes = formData.getAll("hqMinutes").map(String);
    const hqCrews = formData.getAll("hqCrew").map(String);
    const placement = formData.getAll("placementMinutes").map(String);
    const rows = categories.map((category, index) => ({
      category,
      needs_assembly: assembly[index] === "yes" ? true : assembly[index] === "no" ? false : null,
      crew: crews[index] ? Number(crews[index]) : null,
      build_minutes: minutes[index] ? Number(minutes[index]) : null,
      build_location: locations[index] === "hq" ? "hq" : "site",
      hq_build_minutes: hqMinutes[index] ? Number(hqMinutes[index]) : null,
      hq_build_crew: hqCrews[index] ? Number(hqCrews[index]) : null,
      site_position_minutes: placement[index] ? Number(placement[index]) : null,
      status: "suggested",
      notes: notes[index] ?? "",
    }));
    const { error } = await supabase.rpc("orbit_save_cin7_category_defaults", { p_rows: rows });
    if (error) throw new Error(messageFromError(error, "Could not save category defaults."));
    revalidatePath("/operations/settings");
    return { ok: true, message: "Category defaults saved." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not save category defaults." };
  }
}

export async function saveMissingCategoryDefaults(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const supabase = await ownerClient();
    const categories = formData.getAll("category").map(String);
    const assembly = formData.getAll("needsAssembly").map(String);
    const crews = formData.getAll("crew").map(String);
    const minutes = formData.getAll("minutes").map(String);
    const notes = formData.getAll("notes").map(String);
    const locations = formData.getAll("buildLocation").map(String);
    const hqMinutes = formData.getAll("hqMinutes").map(String);
    const hqCrews = formData.getAll("hqCrew").map(String);
    const placement = formData.getAll("placementMinutes").map(String);
    const rows = categories
      .map((category, index) => ({
        category,
        needs_assembly: assembly[index] === "yes" ? true : assembly[index] === "no" ? false : null,
        crew: crews[index] ? Number(crews[index]) : null,
        build_minutes: minutes[index] ? Number(minutes[index]) : null,
        build_location: locations[index] === "hq" ? "hq" : "site",
        hq_build_minutes: hqMinutes[index] ? Number(hqMinutes[index]) : null,
        hq_build_crew: hqCrews[index] ? Number(hqCrews[index]) : null,
        site_position_minutes: placement[index] ? Number(placement[index]) : null,
        status: "suggested",
        notes: notes[index] ?? "",
      }))
      .filter((row) => row.needs_assembly !== null || row.build_location === "hq");
    if (rows.length === 0) return { ok: false, message: "Choose assembly for at least one category." };
    const { error } = await supabase.rpc("orbit_save_cin7_category_defaults", { p_rows: rows });
    if (error) throw new Error(messageFromError(error, "Could not save those category defaults."));
    revalidatePath("/operations/settings");
    return { ok: true, message: `Saved ${rows.length} category defaults.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not save those category defaults." };
  }
}

export async function bulkUpdateSkuEffort(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const supabase = await ownerClient();
    const skus = formData.getAll("sku").map(String).filter(Boolean);
    if (skus.length === 0) return { ok: false, message: "Select at least one SKU." };
    const intent = String(formData.get("intent") ?? "");
    const assembly = String(formData.get("needsAssembly") ?? "");
    const crewText = String(formData.get("crew") ?? "").trim();
    const minuteText = String(formData.get("minutes") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();
    const location = String(formData.get("buildLocation") ?? "");
    const hqMinutes = String(formData.get("hqMinutes") ?? "").trim();
    const hqCrew = String(formData.get("hqCrew") ?? "").trim();
    const placement = String(formData.get("placementMinutes") ?? "").trim();
    const { data, error } = await supabase.rpc("orbit_update_sku_effort", {
      p_skus: skus,
      p_needs_assembly: assembly,
      p_crew: crewText ? Number(crewText) : null,
      p_minutes: minuteText ? Number(minuteText) : null,
      p_status: intent === "confirm" ? "confirmed" : null,
      p_notes: notes || null,
      p_build_location: location === "hq" || location === "site" ? location : null,
      p_hq_minutes: hqMinutes ? Number(hqMinutes) : null,
      p_hq_crew: hqCrew ? Number(hqCrew) : null,
      p_position_minutes: placement ? Number(placement) : null,
    });
    if (error) throw new Error(messageFromError(error, "Could not update those rows."));
    revalidatePath("/operations/settings");
    return { ok: true, message: `Updated ${data ?? skus.length} rows.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not update those rows." };
  }
}

export async function importSkuEffort(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const supabase = await ownerClient();
    const file = formData.get("csv");
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a CSV file." };
    if (file.size > 2 * 1024 * 1024) return { ok: false, message: "That CSV is larger than 2 MB." };
    const [header, ...records] = parseCsv(await file.text());
    const index = new Map(header.map((name, position) => [name.trim().toLowerCase(), position]));
    const column = (record: string[], name: string) => (record[index.get(name) ?? -1] ?? "").trim();
    if (!index.has("sku")) return { ok: false, message: "The CSV needs a sku column." };
    const rows = records
      .map((record) => ({
        sku: column(record, "sku"),
        product_name: column(record, "product_name"),
        cin7_category: column(record, "cin7_category"),
        needs_assembly: column(record, "needs_assembly"),
        crew: column(record, "crew"),
        build_minutes: column(record, "build_minutes"),
        build_location: column(record, "build_location"),
        hq_build_minutes: column(record, "hq_build_minutes"),
        hq_build_crew: column(record, "hq_build_crew"),
        site_position_minutes: column(record, "site_position_minutes"),
        status: column(record, "status"),
        notes: column(record, "notes"),
      }))
      .filter((row) => row.sku);
    const { data, error } = await supabase.rpc("orbit_import_sku_effort", { p_rows: rows });
    if (error) throw new Error(messageFromError(error, "Could not import that CSV."));
    revalidatePath("/operations/settings");
    return { ok: true, message: `Imported ${data ?? rows.length} SKUs.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not import that CSV." };
  }
}
