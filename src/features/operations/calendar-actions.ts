"use server";

import { revalidatePath } from "next/cache";
import { requireOperationsUser } from "@/lib/auth";
import { messageFromError } from "@/lib/errors";
import type { ActionState } from "@/lib/action-state";
import { createClient } from "@/lib/supabase/server";

export async function recordUnavailability(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireOperationsUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("orbit_add_unavailability", {
    p_resource_id: String(formData.get("resourceId") ?? ""),
    p_starts: String(formData.get("starts") ?? ""),
    p_ends: String(formData.get("ends") ?? ""),
    p_reason: String(formData.get("reason") ?? "other"),
  });
  if (error) return { ok: false, message: messageFromError(error, "Could not save unavailability.") };
  revalidatePath("/operations/calendar");
  revalidatePath("/operations/schedule");
  return { ok: true, message: "Unavailability saved." };
}

export async function bookFixture(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireOperationsUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("orbit_book_fixture", {
    p_job_id: String(formData.get("jobId") ?? ""),
    p_resource_id: String(formData.get("resourceId") ?? ""),
    p_day: String(formData.get("day") ?? ""),
    p_kind: String(formData.get("kind") ?? "pencil"),
  });
  if (error) return { ok: false, message: messageFromError(error, "Could not book that job.") };
  revalidatePath("/operations/calendar");
  revalidatePath("/operations/jobs");
  return { ok: true, message: "Fixture booking saved. A firm hold marks the job booked." };
}
