"use server";

import { revalidatePath } from "next/cache";
import { isChangeField } from "@/lib/hr/change-requests";
import { messageFromError } from "@/lib/errors";
import { isFixtureMode } from "@/lib/env";
import type { ActionState } from "@/lib/action-state";
import { createClient } from "@/lib/supabase/server";

function done(path: string, message: string): ActionState {
  revalidatePath(path);
  revalidatePath("/people");
  revalidatePath("/people/team");
  revalidatePath("/people/time-off");
  revalidatePath("/people/me");
  revalidatePath("/people/cases");
  return { ok: true, message };
}

async function call(fn: string, args: Record<string, unknown>, fallback: string): Promise<ActionState | null> {
  if (isFixtureMode()) return null;
  const supabase = await createClient();
  const result = await supabase.rpc(fn, args);
  if (result.error) return { ok: false, message: messageFromError(result.error, fallback) };
  return null;
}

export async function requestLeave(_state: ActionState, formData: FormData): Promise<ActionState> {
  const start = String(formData.get("start") ?? "");
  const end = String(formData.get("end") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) {
    return { ok: false, message: "Check the dates." };
  }
  const failed = await call("hr_request_leave", {
    p_start: start,
    p_end: end,
    p_start_half: formData.get("startHalf") === "on",
    p_end_half: formData.get("endHalf") === "on",
    p_kind: "annual",
    p_note: "",
  }, "Could not send that request.");
  if (failed) return failed;
  return done("/people/time-off", "Request sent.");
}

export async function reportSickness(_state: ActionState, formData: FormData): Promise<ActionState> {
  const start = String(formData.get("start") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return { ok: false, message: "Check the date." };
  if (!reason) return { ok: false, message: "Choose a reason." };
  const failed = await call("hr_report_sickness", {
    p_employee: null,
    p_start: start,
    p_reason: reason,
  }, "Could not report that sickness.");
  if (failed) return failed;
  return done("/people", "Sickness reported.");
}

export async function submitChange(_state: ActionState, formData: FormData): Promise<ActionState> {
  const field = String(formData.get("field") ?? "");
  const value = String(formData.get("value") ?? "").trim();
  if (!isChangeField(field)) return { ok: false, message: "That detail cannot be requested here." };
  if (!value) return { ok: false, message: "Enter the new value." };
  const payload = field === "home_address"
    ? { line: value }
    : field === "emergency_contacts"
      ? [{ name: value, relationship: "", phone_primary: String(formData.get("phone") ?? ""), phone_secondary: "" }]
      : value;
  const failed = await call("hr_submit_change", { p_field: field, p_value: payload }, "Could not send that change.");
  if (failed) return failed;
  return done("/people/me", "Change sent.");
}

export async function decideLeave(_state: ActionState, formData: FormData): Promise<ActionState> {
  if (isFixtureMode()) return done("/people/time-off", formData.get("intent") === "approve" ? "Approved." : "Rejected.");
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, message: "That request is not here." };
  const failed = await call("hr_decide_leave", {
    p_id: id,
    p_approve: formData.get("intent") === "approve",
    p_note: String(formData.get("note") ?? ""),
  }, "Could not decide that request.");
  if (failed) return failed;
  return done("/people/time-off", formData.get("intent") === "approve" ? "Approved." : "Rejected.");
}

export async function decideChange(_state: ActionState, formData: FormData): Promise<ActionState> {
  if (isFixtureMode()) return done("/people/team", formData.get("intent") === "approve" ? "Approved." : "Rejected.");
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, message: "That request is not here." };
  const failed = await call("hr_decide_change", {
    p_id: id,
    p_approve: formData.get("intent") === "approve",
    p_note: String(formData.get("note") ?? ""),
  }, "Could not decide that request.");
  if (failed) return failed;
  return done("/people/team", formData.get("intent") === "approve" ? "Approved." : "Rejected.");
}

export async function openCase(_state: ActionState, formData: FormData): Promise<ActionState> {
  if (isFixtureMode()) return done("/people/cases", "Case opened.");
  const subject = String(formData.get("subject") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const type = String(formData.get("type") ?? "");
  const route = String(formData.get("route") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(subject)) return { ok: false, message: "Choose a person." };
  if (!title) return { ok: false, message: "Add a title." };
  if (!["disciplinary", "grievance", "performance", "health", "flexible_working"].includes(type)) {
    return { ok: false, message: "Choose a case type." };
  }
  if (route !== "manager" && route !== "director_only") return { ok: false, message: "Choose a route." };
  const failed = await call("hr_open_case", {
    p_type: type,
    p_subject: subject,
    p_title: title,
    p_route: route,
  }, "Could not open that case.");
  if (failed) return failed;
  return done("/people/cases", "Case opened.");
}
