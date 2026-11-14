import "server-only";

import { absenceType, type CalendarItem, type CalendarType } from "@/lib/company-calendar";
import { listPeople } from "@/features/policies/queries";
import { createClient } from "@/lib/supabase/server";

export type CalendarEntryRow = {
  id: string;
  entry_type: CalendarType;
  profile_id: string | null;
  starts_on: string;
  ends_on: string;
  notes: string | null;
};

const TYPES = new Set(["annual_leave", "sick", "other_absence", "company_event"]);

export async function loadCompanyCalendar(from: string, to: string) {
  const supabase = await createClient();
  const [entriesResult, absenceResult, people] = await Promise.all([
    supabase
      .from("calendar_entries")
      .select("id, entry_type, profile_id, starts_on, ends_on, notes, request_status")
      .eq("request_status", "confirmed")
      .order("starts_on"),
    supabase.rpc("people_resource_absence", { p_from: from, p_to: to }),
    listPeople().catch(() => []),
  ]);

  const names = new Map(people.map((person) => [person.id, person.full_name || person.email]));
  const entries = (Array.isArray(entriesResult.data) ? entriesResult.data : []) as Array<CalendarEntryRow & { request_status?: string }>;
  const items: CalendarItem[] = entries
    .filter((row) => TYPES.has(row.entry_type) && row.ends_on >= from && row.starts_on <= to)
    .map((row) => ({
      id: row.id,
      entryType: row.entry_type,
      name: row.profile_id ? names.get(row.profile_id) ?? null : null,
      startsOn: String(row.starts_on).slice(0, 10),
      endsOn: String(row.ends_on).slice(0, 10),
      notes: row.notes,
      source: "entry" as const,
    }));

  const absence = Array.isArray(absenceResult.data) ? absenceResult.data : [];
  for (const row of absence) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const id = String(item.id ?? "");
    const startsOn = String(item.startsOn ?? "").slice(0, 10);
    const endsOn = String(item.endsOn ?? "").slice(0, 10);
    if (!id || !startsOn || !endsOn) continue;
    items.push({
      id: `resource-${id}`,
      entryType: absenceType(String(item.reason ?? "other")),
      name: item.name ? String(item.name) : null,
      startsOn,
      endsOn,
      notes: item.notes ? String(item.notes) : null,
      source: "resource",
    });
  }

  return {
    items,
    people,
    entries,
    error: entriesResult.error ? "Company calendar is not available yet." : null,
  };
}
