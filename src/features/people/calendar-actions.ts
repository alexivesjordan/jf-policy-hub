"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspaceAdmin } from "@/lib/auth";
import { CALENDAR_TYPES } from "@/lib/company-calendar";
import { messageFromError } from "@/lib/errors";
import type { ActionState } from "@/lib/action-state";
import { createClient } from "@/lib/supabase/server";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[0-9a-f-]{36}$/i;

function clean(formData: FormData) {
  const entryType = String(formData.get("entryType") ?? "");
  const profileId = String(formData.get("profileId") ?? "");
  const startsOn = String(formData.get("startsOn") ?? "");
  const endsOn = String(formData.get("endsOn") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();
  if (!CALENDAR_TYPES.includes(entryType as (typeof CALENDAR_TYPES)[number])) return { error: "Choose a type." };
  if (!DAY.test(startsOn) || !DAY.test(endsOn) || endsOn < startsOn) return { error: "Check the dates." };
  if (notes.length > 500) return { error: "Shorten the note." };
  if (profileId && !ID.test(profileId)) return { error: "Choose a person." };
  if (entryType !== "company_event" && !profileId) return { error: "Choose a person." };
  return {
    entry_type: entryType,
    profile_id: profileId || null,
    starts_on: startsOn,
    ends_on: endsOn,
    notes: notes || null,
    request_status: "confirmed",
  };
}

export async function saveCalendarEntry(_state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await requireWorkspaceAdmin();
  const row = clean(formData);
  if ("error" in row) return { ok: false, message: row.error ?? "Check the entry." };
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const saved = id
    ? await supabase.from("calendar_entries").update(row).eq("id", id)
    : await supabase.from("calendar_entries").insert({ ...row, created_by: profile.id });
  if (saved.error) return { ok: false, message: messageFromError(saved.error, "Could not save that entry.") };
  revalidatePath("/people/calendar");
  return { ok: true, message: "Saved." };
}

export async function deleteCalendarEntry(formData: FormData) {
  await requireWorkspaceAdmin();
  const id = String(formData.get("id") ?? "");
  if (!ID.test(id)) return;
  const supabase = await createClient();
  await supabase.from("calendar_entries").delete().eq("id", id);
  revalidatePath("/people/calendar");
}
