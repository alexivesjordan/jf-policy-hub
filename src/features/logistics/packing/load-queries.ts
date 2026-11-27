import "server-only";

import { messageFromError } from "@/lib/errors";
import { collectLoadLines, reopenPlan, type LoadLine, type LoadPlanView } from "@/lib/packing/load-plan";
import type { LoadSpace } from "@/lib/packing/types";
import { createClient } from "@/lib/supabase/server";

export type PlannerSpace = LoadSpace & { name: string; active: boolean; sortOrder: number };

export type LoadPlanListItem = {
  id: string;
  name: string;
  reference: string;
  spaceCode: string;
  updatedAt: string;
};

export type OpenLoadPlan = {
  id: string;
  name: string;
  reference: string;
  spaceCode: string;
  lines: LoadLine[];
  summary: LoadPlanView | null;
};

const SPACE_COLUMNS = "code, kind, name, length_cm, width_cm, height_cm, max_weight_kg, tare_kg, deck_cm, active, sort_order";

export async function canAdminLoadSpaces() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("logistics_can_admin_spaces");
  if (error) return false;
  return data === true;
}

export async function listPlannerSpaces(activeOnly: boolean): Promise<PlannerSpace[]> {
  const supabase = await createClient();
  const result = await supabase.schema("logistics").from("load_spaces").select(SPACE_COLUMNS);
  if (result.error) throw new Error(messageFromError(result.error, "Could not load containers and vehicles."));
  return ((result.data ?? []) as Record<string, unknown>[])
    .flatMap((row) => {
      const space = spaceFromRow(row);
      if (!space || (space.kind !== "container" && space.kind !== "vehicle")) return [];
      if (activeOnly && !space.active) return [];
      return [space];
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export async function listLoadPlans(): Promise<LoadPlanListItem[]> {
  const supabase = await createClient();
  const result = await supabase.schema("logistics").from("load_plans")
    .select("id, name, reference, space_code, updated_at");
  if (result.error) throw new Error(messageFromError(result.error, "Could not load saved plans."));
  return ((result.data ?? []) as Record<string, unknown>[])
    .flatMap((row) => {
      const id = typeof row.id === "string" ? row.id : "";
      if (!id) return [];
      return [{
        id,
        name: typeof row.name === "string" ? row.name : "Load plan",
        reference: typeof row.reference === "string" ? row.reference : "",
        spaceCode: typeof row.space_code === "string" ? row.space_code : "",
        updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
      }];
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 30);
}

export async function openLoadPlan(id: string): Promise<OpenLoadPlan | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const supabase = await createClient();
  const result = await supabase.schema("logistics").from("load_plans")
    .select("id, name, reference, space_code, pieces, summary")
    .eq("id", id)
    .maybeSingle();
  if (result.error) throw new Error(messageFromError(result.error, "Could not open that plan."));
  if (!result.data) return null;
  const row = result.data as Record<string, unknown>;
  const collected = collectLoadLines(row.pieces);
  return {
    id: String(row.id),
    name: typeof row.name === "string" ? row.name : "Load plan",
    reference: typeof row.reference === "string" ? row.reference : "",
    spaceCode: typeof row.space_code === "string" ? row.space_code : "",
    lines: collected.lines,
    summary: reopenPlan(row.summary),
  };
}

export async function loadPlannerSpace(code: string): Promise<PlannerSpace | null> {
  const supabase = await createClient();
  const result = await supabase.schema("logistics").from("load_spaces")
    .select(SPACE_COLUMNS)
    .eq("code", code)
    .maybeSingle();
  if (result.error) throw new Error(messageFromError(result.error, "Could not load that container."));
  if (!result.data) return null;
  const space = spaceFromRow(result.data as Record<string, unknown>);
  if (!space || (space.kind !== "container" && space.kind !== "vehicle")) return null;
  return space;
}

function spaceFromRow(row: Record<string, unknown>): PlannerSpace | null {
  const kind = row.kind === "container" || row.kind === "vehicle" || row.kind === "pallet" ? row.kind : null;
  const lengthCm = num(row.length_cm);
  const widthCm = num(row.width_cm);
  const heightCm = num(row.height_cm);
  const maxWeightKg = num(row.max_weight_kg);
  if (!kind || lengthCm == null || widthCm == null || heightCm == null || maxWeightKg == null) return null;
  return {
    code: String(row.code ?? ""),
    kind,
    name: String(row.name ?? row.code ?? ""),
    lengthCm,
    widthCm,
    heightCm,
    maxWeightKg,
    deckCm: num(row.deck_cm) ?? 0,
    tareKg: num(row.tare_kg) ?? 0,
    active: row.active !== false,
    sortOrder: num(row.sort_order) ?? 0,
  };
}

function num(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
