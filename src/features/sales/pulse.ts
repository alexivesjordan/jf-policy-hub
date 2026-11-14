import "server-only";

import { salesPulseMeta, type SalesPulseRow } from "@/lib/sales-pulse";
import { createClient } from "@/lib/supabase/server";

export type SalesPulse = {
  admin: boolean;
  repId: string | null;
  reps: { id: string; name: string }[];
  waiting: SalesPulseRow[];
  replies: SalesPulseRow[];
  access: SalesPulseRow[];
  week: SalesPulseRow[];
  error: string | null;
};

const EMPTY: SalesPulse = {
  admin: false,
  repId: null,
  reps: [],
  waiting: [],
  replies: [],
  access: [],
  week: [],
  error: null,
};

function rows(value: unknown): SalesPulseRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? "");
    const kind = row.kind === "quote" ? "quote" : row.kind === "install" ? "install" : null;
    if (!id || !kind) return [];
    return [{
      id,
      kind,
      orderNumber: String(row.orderNumber ?? "Order"),
      customerName: String(row.customerName ?? ""),
      meta: salesPulseMeta(row),
    }];
  });
}

export async function loadSalesPulse(repId: string | null): Promise<SalesPulse> {
  const supabase = await createClient();
  const loaded = await supabase.rpc("sales_pulse", { p_rep: repId });
  if (loaded.error) {
    return { ...EMPTY, error: "Sales overview is not available yet." };
  }
  const data = (loaded.data ?? {}) as Record<string, unknown>;
  const reps = Array.isArray(data.reps)
    ? data.reps.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        const id = String(row.id ?? "");
        if (!id) return [];
        return [{ id, name: String(row.name ?? "Rep") }];
      })
    : [];
  return {
    admin: data.admin === true,
    repId: typeof data.repId === "string" ? data.repId : null,
    reps,
    waiting: rows(data.waiting),
    replies: rows(data.replies),
    access: rows(data.access),
    week: rows(data.week),
    error: null,
  };
}
