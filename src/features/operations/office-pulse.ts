import "server-only";

import { createClient } from "@/lib/supabase/server";

export type OfficeJob = {
  id: string;
  kind: "install" | "job";
  orderNumber: string;
  customerName: string;
  startOn: string | null;
};

export type OfficePulse = {
  installsToday: OfficeJob[];
  installsWeek: OfficeJob[];
  servicesToday: OfficeJob[];
  servicesWeek: OfficeJob[];
  off: { name: string; label: string; startsOn: string; endsOn: string }[];
  vansOut: { id: string; registration: string; orderNumber: string }[];
  overdue: { id: string; title: string; dueAt: string | null; assignee: string | null }[];
  warnings: { label: string; detail: string; href: string }[];
  error: string | null;
};

function jobs(value: unknown, fallback: "install" | "job" = "install"): OfficeJob[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? "");
    if (!id) return [];
    return [{
      id,
      kind: row.kind === "job" ? "job" : fallback,
      orderNumber: String(row.orderNumber ?? "Job"),
      customerName: String(row.customerName ?? ""),
      startOn: row.startOn ? String(row.startOn).slice(0, 10) : null,
    }];
  });
}

export async function loadOfficePulse(): Promise<OfficePulse> {
  const empty: OfficePulse = {
    installsToday: [],
    installsWeek: [],
    servicesToday: [],
    servicesWeek: [],
    off: [],
    vansOut: [],
    overdue: [],
    warnings: [],
    error: null,
  };
  const supabase = await createClient();
  const loaded = await supabase.rpc("ops_pulse");
  if (loaded.error || !loaded.data || typeof loaded.data !== "object") {
    return { ...empty, error: "Operations overview is not available yet." };
  }
  const data = loaded.data as Record<string, unknown>;
  return {
    installsToday: jobs(data.installsToday),
    installsWeek: jobs(data.installsWeek),
    servicesToday: jobs(data.servicesToday),
    servicesWeek: jobs(data.servicesWeek),
    off: Array.isArray(data.off)
      ? data.off.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const row = item as Record<string, unknown>;
          return [{
            name: String(row.name ?? "Someone"),
            label: String(row.label ?? "Away"),
            startsOn: String(row.startsOn ?? "").slice(0, 10),
            endsOn: String(row.endsOn ?? "").slice(0, 10),
          }];
        })
      : [],
    vansOut: Array.isArray(data.vansOut)
      ? data.vansOut.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const row = item as Record<string, unknown>;
          return [{ id: String(row.id ?? ""), registration: String(row.registration ?? ""), orderNumber: String(row.orderNumber ?? "") }];
        })
      : [],
    overdue: Array.isArray(data.overdue)
      ? data.overdue.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const row = item as Record<string, unknown>;
          return [{ id: String(row.id ?? ""), title: String(row.title ?? "Task"), dueAt: row.dueAt ? String(row.dueAt) : null, assignee: row.assignee ? String(row.assignee) : null }];
        })
      : [],
    warnings: Array.isArray(data.warnings)
      ? data.warnings.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const row = item as Record<string, unknown>;
          return [{ label: String(row.label ?? "Warning"), detail: String(row.detail ?? ""), href: String(row.href ?? "/operations") }];
        })
      : [],
    error: null,
  };
}

export type ScheduleEvent = {
  rowKind: "engineer" | "van";
  rowId: string;
  day: string;
  kind: string;
  label: string;
  href: string | null;
};

export async function loadSchedule(from: string, to: string) {
  const supabase = await createClient();
  const loaded = await supabase.rpc("ops_schedule", { p_from: from, p_to: to });
  if (loaded.error || !loaded.data || typeof loaded.data !== "object") {
    return { engineers: [] as { id: string; name: string }[], vans: [] as { id: string; registration: string; makeModel: string | null }[], events: [] as ScheduleEvent[], error: "Schedule is not available yet." };
  }
  const data = loaded.data as Record<string, unknown>;
  const engineers = Array.isArray(data.engineers)
    ? data.engineers.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        return [{ id: String(row.id ?? ""), name: String(row.name ?? "Engineer") }];
      })
    : [];
  const vans = Array.isArray(data.vans)
    ? data.vans.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        return [{ id: String(row.id ?? ""), registration: String(row.registration ?? ""), makeModel: row.makeModel ? String(row.makeModel) : null }];
      })
    : [];
  const events: ScheduleEvent[] = Array.isArray(data.events)
    ? data.events.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        return [{
          rowKind: row.rowKind === "van" ? "van" : "engineer",
          rowId: String(row.rowId ?? ""),
          day: String(row.day ?? "").slice(0, 10),
          kind: String(row.kind ?? "job"),
          label: String(row.label ?? ""),
          href: row.href ? String(row.href) : null,
        }];
      })
    : [];
  return { engineers, vans, events, error: null as string | null };
}
