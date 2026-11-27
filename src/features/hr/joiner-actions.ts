"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createFieldEngineer, discardFieldEngineer } from "@/features/installs/engineer-resource";
import { joinerProblem, samePersonName } from "@/lib/hr/checklists";
import { messageFromError } from "@/lib/errors";
import { isFixtureMode } from "@/lib/env";
import type { ActionState } from "@/lib/action-state";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function isUuid(value: string) {
  return /^[0-9a-f-]{36}$/i.test(value);
}

export async function createJoiner(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const fullName = clean(formData.get("fullName")).replace(/\s+/g, " ");
  const installEngineer = formData.get("installEngineer") === "yes";
  const problem = joinerProblem({
    fullName,
    location: clean(formData.get("location")),
    startDate: clean(formData.get("start")),
    workEmail: clean(formData.get("workEmail")),
    hours: clean(formData.get("hours")),
    installEngineer,
    engineerRole: clean(formData.get("engineerRole")),
  }, []);
  if (problem) return { ok: false, message: problem };
  if (isFixtureMode()) {
    revalidatePath("/people");
    revalidatePath("/people/team");
    redirect("/people/team/emp-avery?tab=checklist");
  }
  const supabase = await createClient();
  let engineerId: string | null = null;
  if (installEngineer) {
    const admin = await supabase.rpc("workspace_is_admin");
    if (admin.data !== true) return { ok: false, message: "You cannot add an engineer." };
    const created = await createFieldEngineer({ name: fullName, role: clean(formData.get("engineerRole")) });
    if (!created.ok) return { ok: false, message: created.message };
    engineerId = created.id;
  }
  const manager = clean(formData.get("manager"));
  const hours = clean(formData.get("hours"));
  const created = await supabase.rpc("hr_create_joiner", {
    p_full_name: fullName,
    p_preferred_name: clean(formData.get("preferredName")),
    p_work_email: clean(formData.get("workEmail")),
    p_phone: clean(formData.get("phone")),
    p_job_title: clean(formData.get("jobTitle")),
    p_department: clean(formData.get("department")),
    p_location: clean(formData.get("location")),
    p_start_date: clean(formData.get("start")),
    p_manager_id: isUuid(manager) ? manager : null,
    p_contract_type: clean(formData.get("contract")),
    p_hours_per_week: hours ? Number(hours) : null,
    p_notice_period: clean(formData.get("notice")),
    p_engineer_resource_id: engineerId,
  });
  if (created.error || typeof created.data !== "string") {
    if (engineerId) await discardFieldEngineer(engineerId);
    return { ok: false, message: messageFromError(created.error, "Could not add that joiner.") };
  }
  revalidatePath("/people");
  revalidatePath("/people/team");
  revalidatePath(`/people/team/${created.data}`);
  redirect(`/people/team/${created.data}?tab=checklist`);
}

export async function startLeaving(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const id = clean(formData.get("id"));
  const name = clean(formData.get("name")).replace(/\s+/g, " ");
  const end = clean(formData.get("end"));
  if (!isUuid(id)) return { ok: false, message: "That person is not here." };
  if (!name) return { ok: false, message: "Confirm the person's name." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return { ok: false, message: "Check the leave date." };
  if (!samePersonName(name, clean(formData.get("confirm")))) {
    return { ok: false, message: "Confirm the person's name." };
  }
  if (isFixtureMode()) {
    revalidatePath(`/people/team/${id}`);
    revalidatePath("/people");
    return { ok: true, message: "Leaving started." };
  }
  const supabase = await createClient();
  const result = await supabase.rpc("hr_start_leaving", { p_employee: id, p_end_date: end, p_name: name });
  if (result.error) return { ok: false, message: messageFromError(result.error, "Could not start leaving.") };
  revalidatePath(`/people/team/${id}`);
  revalidatePath("/people");
  revalidatePath("/people/team");
  return { ok: true, message: "Leaving started." };
}

export async function setChecklistItem(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const item = clean(formData.get("item"));
  const employee = clean(formData.get("employee"));
  if (!isUuid(item)) return { ok: false, message: "That item is not here." };
  if (isFixtureMode()) return { ok: true, message: formData.get("done") === "yes" ? "Done." : "Undone." };
  const supabase = await createClient();
  const result = await supabase.rpc("hr_set_checklist_item", {
    p_item: item,
    p_done: formData.get("done") === "yes",
  });
  if (result.error) return { ok: false, message: messageFromError(result.error, "Could not update that item.") };
  if (isUuid(employee)) revalidatePath(`/people/team/${employee}`);
  revalidatePath("/people");
  revalidatePath("/people/team");
  return { ok: true, message: formData.get("done") === "yes" ? "Done." : "Undone." };
}
