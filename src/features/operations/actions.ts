"use server";

import { revalidatePath } from "next/cache";
import { requireOperationsUser } from "@/lib/auth";
import { messageFromError } from "@/lib/errors";
import type { ActionState } from "@/lib/action-state";
import { createClient } from "@/lib/supabase/server";

async function callRpc(fn: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) throw new Error(messageFromError(error, "That could not be saved."));
}

function requiredText(formData: FormData, name: string, label: string, max = 500) {
  const value = String(formData.get(name) ?? "").trim();
  if (!value || value.length > max) throw new Error(`Add ${label}.`);
  return value;
}

function percentToFraction(raw: FormDataEntryValue | null, label: string) {
  const text = String(raw ?? "").trim();
  if (!text) throw new Error(`Enter ${label}.`);
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`Enter ${label} as a number.`);
  return Math.round((value / 100) * 10000) / 10000;
}

function optionalPercent(raw: FormDataEntryValue | null, label: string) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`Enter ${label} as a number, or leave it blank.`);
  return Math.round((value / 100) * 10000) / 10000;
}

function optionalMoney(raw: FormDataEntryValue | null, label: string) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`Enter ${label} as a number, or leave it blank.`);
  return value;
}

function requiredNumber(raw: FormDataEntryValue | null, label: string) {
  const text = String(raw ?? "").trim();
  const value = Number(text);
  if (!text || !Number.isFinite(value)) throw new Error(`Enter ${label} as a number.`);
  return value;
}

export async function savePricing(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireOperationsUser();
  try {
    await callRpc("orbit_save_pricing", {
      p_markup_independent: percentToFraction(formData.get("markupIndependent"), "the independent markup"),
      p_markup_franchisee: percentToFraction(formData.get("markupFranchisee"), "the franchisee markup"),
      p_markup_trade: percentToFraction(formData.get("markupTrade"), "the trade markup"),
      p_markup_big_corporate: percentToFraction(formData.get("markupCorporate"), "the corporate markup"),
      p_min_job_charge: optionalMoney(formData.get("minJobCharge"), "the minimum job charge"),
      p_margin_floor_pct: optionalPercent(formData.get("marginFloor"), "the margin floor"),
      p_custom_deposit_fraction: percentToFraction(formData.get("depositPercent"), "the custom deposit"),
      p_large_order_threshold: requiredNumber(formData.get("largeOrder"), "the large-order threshold"),
      p_variation_rounding_hours: requiredNumber(formData.get("roundingHours"), "the variation rounding"),
      p_change_reason: requiredText(formData, "reason", "a short reason"),
    });
    revalidatePath("/operations/settings");
    return { ok: true, message: "Saved a new pricing version. The previous version is unchanged." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not save pricing." };
  }
}

export async function saveCategoryEffort(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireOperationsUser();
  try {
    const categories = formData.getAll("category").map(String);
    const crews = formData.getAll("buildCrew").map((value) => Number(value));
    const minutes = formData.getAll("buildMinutes").map((value) => Number(value));
    const notes = formData.getAll("note").map(String);
    const rows = categories.map((category, index) => ({
      category: category.trim(),
      build_crew: crews[index],
      build_minutes: minutes[index],
      note: notes[index]?.trim() || "Category build default",
    }));
    if (rows.some((row) => !row.category || !Number.isFinite(row.build_crew) || !Number.isFinite(row.build_minutes))) {
      return { ok: false, message: "Each category needs a crew and a build time." };
    }
    await callRpc("orbit_save_category_effort_defaults", {
      p_rows: rows,
      p_reason: requiredText(formData, "reason", "a short reason"),
    });
    revalidatePath("/operations/settings");
    return { ok: true, message: "Saved a new category effort version." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not save effort defaults." };
  }
}

export async function saveTerms(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireOperationsUser();
  try {
    const labels = formData.getAll("label").map((value) => String(value));
    const rates = formData.getAll("rate");
    const mileages = formData.getAll("mileage");
    if (labels.length === 0) throw new Error("The charges grid is empty.");
    const lines = labels.map((label, index) => ({
      label,
      rate: String(rates[index] ?? "").trim(),
      mileage: String(mileages[index] ?? "").trim(),
    }));
    await callRpc("orbit_save_terms", {
      p_lines: lines,
      p_change_reason: requiredText(formData, "reason", "a short reason"),
    });
    revalidatePath("/operations/settings");
    return { ok: true, message: "Saved a new charges version. It is not marked live." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not save the charges grid." };
  }
}

export async function createGateOverride(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireOperationsUser();
  try {
    await callRpc("orbit_insert_gate_override", {
      p_entity_schema: "ops",
      p_entity_table: "install_jobs",
      p_entity_id: requiredText(formData, "jobId", "a job", 80),
      p_gate: requiredText(formData, "gate", "a gate", 80),
      p_reason: requiredText(formData, "reason", "a reason", 2000),
    });
    revalidatePath("/operations/overrides");
    return { ok: true, message: "Override recorded." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not record that override." };
  }
}

export async function createOrbitTask(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireOperationsUser();
  try {
    const kind = String(formData.get("kind") ?? "exception");
    const priority = String(formData.get("priority") ?? "normal");
    await callRpc("orbit_create_task", {
      p_kind: kind,
      p_title: requiredText(formData, "title", "a title", 200),
      p_body: String(formData.get("body") ?? "").trim() || null,
      p_priority: priority,
      p_due_at: null,
      p_assignee_id: null,
      p_entity_schema: null,
      p_entity_table: null,
      p_entity_id: null,
    });
    revalidatePath("/operations/tasks");
    return { ok: true, message: "Task added." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not add that task." };
  }
}

export async function markOrbitNotificationRead(formData: FormData) {
  await requireOperationsUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.rpc("orbit_mark_notifications_read", { p_ids: [id] });
  revalidatePath("/operations/notifications");
  revalidatePath("/operations");
  revalidatePath("/", "layout");
}

export async function markAllOrbitNotificationsRead() {
  await requireOperationsUser();
  const supabase = await createClient();
  await supabase.rpc("orbit_mark_notifications_read", { p_ids: null });
  revalidatePath("/operations/notifications");
  revalidatePath("/operations");
  revalidatePath("/", "layout");
}
