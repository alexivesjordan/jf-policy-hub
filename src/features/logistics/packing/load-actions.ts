"use server";

import { revalidatePath } from "next/cache";
import { requireLogisticsApi } from "@/features/logistics/commercial-invoice/access";
import { loadPackagesForSkus } from "@/features/logistics/packing/queries";
import { canAdminLoadSpaces, loadPlannerSpace } from "@/features/logistics/packing/load-queries";
import { messageFromError } from "@/lib/errors";
import { packingListFromCsv } from "@/lib/packing/csv";
import { collectLoadLines, linesFromPackingRows, planLoad, type LoadLine } from "@/lib/packing/load-plan";
import { usableInterior } from "@/lib/packing/space";
import { readLoadSpace } from "@/lib/packing/space-input";
import type { PackageSpec } from "@/lib/packing/types";
import { createClient } from "@/lib/supabase/server";

export type LoadSaveResult = { ok: true; message: string; id: string } | { ok: false; message: string };

async function logisticsClient() {
  const gate = await requireLogisticsApi();
  if (gate.error || !gate.profile) throw new Error(gate.error ?? "Sign in required.");
  return { supabase: await createClient(), profile: gate.profile };
}

export async function packagesForLoad(skus: string[]): Promise<{ ok: true; packages: PackageSpec[] } | { ok: false; message: string }> {
  try {
    await logisticsClient();
    const wanted = [...new Set(skus.map((sku) => sku.trim()).filter(Boolean))].slice(0, 80);
    return { ok: true, packages: await loadPackagesForSkus(wanted) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not load packaging." };
  }
}

export async function parsePackingList(text: string): Promise<{ ok: true; lines: LoadLine[] } | { ok: false; message: string }> {
  try {
    await logisticsClient();
    if (text.length > 500_000) return { ok: false, message: "That CSV is too large." };
    const parsed = packingListFromCsv(text);
    if (parsed.error) return { ok: false, message: parsed.error };
    return { ok: true, lines: linesFromPackingRows(parsed.rows) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not read that CSV." };
  }
}

export async function saveLoadPlan(input: {
  id: string | null;
  name: string;
  spaceCode: string;
  reference: string;
  lines: unknown;
}): Promise<LoadSaveResult> {
  try {
    const { supabase, profile } = await logisticsClient();
    const name = input.name.trim() || "Load plan";
    if (name.length > 120) return { ok: false, message: "Name must be 120 characters or fewer." };
    const reference = input.reference.trim();
    if (reference.length > 200) return { ok: false, message: "Reference must be 200 characters or fewer." };
    const collected = collectLoadLines(input.lines);
    if (collected.problems.length) return { ok: false, message: collected.problems[0]?.message ?? "Check the items." };
    if (!collected.lines.length) return { ok: false, message: "Add items before saving." };
    const space = await loadPlannerSpace(input.spaceCode);
    if (!space) return { ok: false, message: "Choose a container or vehicle." };
    const summary = planLoad(collected.lines, usableInterior(space), {
      code: space.code,
      name: space.name,
      kind: space.kind === "vehicle" ? "vehicle" : "container",
      lengthCm: space.lengthCm,
      widthCm: space.widthCm,
      heightCm: usableInterior(space).heightCm,
      maxGoodsKg: usableInterior(space).maxGoodsKg,
    });
    const row = {
      name,
      space_code: space.code,
      reference,
      pieces: collected.lines,
      summary,
      updated_at: new Date().toISOString(),
    };
    if (input.id) {
      if (!/^[0-9a-f-]{36}$/i.test(input.id)) return { ok: false, message: "That plan is not available." };
      const { error } = await supabase.schema("logistics").from("load_plans").update(row).eq("id", input.id);
      if (error) throw new Error(messageFromError(error, "Could not save that plan."));
      revalidatePath("/logistics/load-plan");
      return { ok: true, message: "Saved.", id: input.id };
    }
    const { data, error } = await supabase.schema("logistics").from("load_plans")
      .insert({ ...row, created_by: profile.id })
      .select("id")
      .single();
    if (error) throw new Error(messageFromError(error, "Could not save that plan."));
    const id = typeof (data as { id?: unknown } | null)?.id === "string" ? (data as { id: string }).id : "";
    if (!id) return { ok: false, message: "Could not save that plan." };
    revalidatePath("/logistics/load-plan");
    return { ok: true, message: "Saved.", id };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not save that plan." };
  }
}

export async function saveLoadSpace(input: {
  code: string;
  name: string;
  kind: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  maxWeightKg: string;
  creating: boolean;
}): Promise<{ ok: boolean; message: string }> {
  try {
    const { supabase } = await logisticsClient();
    if (!(await canAdminLoadSpaces())) return { ok: false, message: "Load spaces are for logistics admins." };
    const parsed = readLoadSpace(input);
    if (!parsed.ok) return parsed;
    if (input.creating) {
      const existing = await supabase.schema("logistics").from("load_spaces").select("sort_order");
      if (existing.error) throw new Error(messageFromError(existing.error, "Could not add that load space."));
      const sortOrder = Math.max(0, ...((existing.data ?? []) as { sort_order?: number }[]).map((row) => Number(row.sort_order) || 0)) + 10;
      const { error } = await supabase.schema("logistics").from("load_spaces").insert({
        code: parsed.value.code,
        kind: parsed.value.kind,
        name: parsed.value.name,
        length_cm: parsed.value.lengthCm,
        width_cm: parsed.value.widthCm,
        height_cm: parsed.value.heightCm,
        max_weight_kg: parsed.value.maxWeightKg,
        tare_kg: 0,
        deck_cm: 0,
        active: true,
        sort_order: sortOrder,
      });
      if (error) return { ok: false, message: spaceError(error, "Could not add that load space.") };
    } else {
      const current = await loadPlannerSpace(parsed.value.code);
      if (!current) return { ok: false, message: "That load space cannot be edited." };
      const { error } = await supabase.schema("logistics").from("load_spaces").update({
        name: parsed.value.name,
        length_cm: parsed.value.lengthCm,
        width_cm: parsed.value.widthCm,
        height_cm: parsed.value.heightCm,
        max_weight_kg: parsed.value.maxWeightKg,
      }).eq("code", parsed.value.code);
      if (error) return { ok: false, message: spaceError(error, "Could not save that load space.") };
    }
    revalidatePath("/logistics/load-spaces");
    revalidatePath("/logistics/load-plan");
    return { ok: true, message: input.creating ? "Added." : "Saved." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not save that load space." };
  }
}

export async function setLoadSpaceActive(code: string, active: boolean): Promise<{ ok: boolean; message: string }> {
  try {
    const { supabase } = await logisticsClient();
    if (!(await canAdminLoadSpaces())) return { ok: false, message: "Load spaces are for logistics admins." };
    const current = await loadPlannerSpace(code);
    if (!current) return { ok: false, message: "That load space cannot be edited." };
    const { error } = await supabase.schema("logistics").from("load_spaces").update({ active }).eq("code", code);
    if (error) return { ok: false, message: spaceError(error, "Could not update that load space.") };
    revalidatePath("/logistics/load-spaces");
    revalidatePath("/logistics/load-plan");
    return { ok: true, message: active ? "Activated." : "Deactivated." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not update that load space." };
  }
}

function spaceError(error: { message?: string; code?: string; details?: string }, fallback: string) {
  if (error.code === "23505") return "That code is already used.";
  return messageFromError(error, fallback);
}
