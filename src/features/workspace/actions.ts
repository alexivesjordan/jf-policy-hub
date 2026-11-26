"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspaceAdmin } from "@/lib/auth";
import { authConfirmRedirect } from "@/lib/site-url";
import { passwordSetupPath } from "@/lib/auth-link";
import { hasServiceRole } from "@/lib/env";
import { messageFromError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { PULSE_MODULE_IDS } from "@/lib/types";
import { personName } from "@/lib/names";
import { newEngineerProblem } from "@/lib/installs/new-engineer";
import { createFieldEngineer, discardFieldEngineer } from "@/features/installs/engineer-resource";

function clean(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

const RESOURCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WorkspaceFormState = { message: string } | null;

function nameProblem(formData: FormData) {
  const first = clean(formData.get("firstName"));
  const last = clean(formData.get("lastName"));
  if (!first && !last) return "Enter a first and last name.";
  if (!first) return "Enter a first name.";
  if (!last) return "Enter a last name.";
  if (first.length > 80 || last.length > 80) return "Enter a shorter name.";
  return null;
}

function installsChoiceProblem(formData: FormData) {
  const installsTeamId = clean(formData.get("installsTeamId"));
  const selected = formData.getAll("teamId").map(String).filter(Boolean);
  if (!installsTeamId || !selected.includes(installsTeamId)) return null;
  const choice = clean(formData.get("fieldResource"));
  if (choice === "office" || choice === "new" || RESOURCE_ID.test(choice)) return null;
  return "Choose a field engineer resource, or mark them as office staff.";
}

async function openNewEngineer(formData: FormData) {
  const choice = clean(formData.get("fieldResource"));
  if (choice !== "new") return { choice, createdId: null as string | null };
  const created = await createFieldEngineer({
    name: clean(formData.get("engineerName")),
    role: clean(formData.get("engineerRole")),
  });
  if (!created.ok) return { choice, createdId: null as string | null, message: created.message };
  return { choice: created.id, createdId: created.id };
}

export async function saveWorkspaceTeam(formData: FormData) {
  await requireWorkspaceAdmin();
  const supabase = await createClient();
  const id = clean(formData.get("teamId"));
  const { error } = await supabase.rpc("workspace_save_team", {
    p_id: id || null,
    p_name: clean(formData.get("name")),
  });
  if (error) throw new Error(messageFromError(error, "Could not save that team."));
  revalidatePath("/settings/workspace/teams");
}

export async function deleteWorkspaceTeam(formData: FormData) {
  await requireWorkspaceAdmin();
  const supabase = await createClient();
  await supabase.rpc("workspace_delete_team", { p_id: clean(formData.get("teamId")) });
  revalidatePath("/settings/workspace/teams");
}

export async function saveWorkspaceUser(_prev: WorkspaceFormState, formData: FormData): Promise<WorkspaceFormState> {
  await requireWorkspaceAdmin();
  const problem = nameProblem(formData) ?? engineerDraftProblem(formData) ?? installsChoiceProblem(formData);
  if (problem) return { message: problem };
  const names = personName(clean(formData.get("firstName")), clean(formData.get("lastName")));
  if (!names) return { message: "Enter a first and last name." };
  const opened = await openNewEngineer(formData);
  if (opened.message) return { message: opened.message };
  const custom: Record<string, string> = {};
  for (const moduleId of PULSE_MODULE_IDS) {
    custom[moduleId] = clean(formData.get(`level-${moduleId}`)) || "none";
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("workspace_save_user", {
    p_profile: clean(formData.get("userId")),
    p_workspace_role: clean(formData.get("workspaceRole")),
    p_access_mode: clean(formData.get("accessMode")),
    p_team_ids: formData.getAll("teamId").map(String).filter(Boolean),
    p_custom: custom,
    p_active: formData.get("isActive") === "yes",
  });
  if (error) {
    if (opened.createdId) await discardFieldEngineer(opened.createdId);
    return { message: messageFromError(error, "Could not save that user.") };
  }
  const named = await supabase.rpc("save_person_name", {
    p_profile: clean(formData.get("userId")),
    p_first_name: names.firstName,
    p_last_name: names.lastName,
  });
  if (named.error) {
    if (opened.createdId) await discardFieldEngineer(opened.createdId);
    return { message: messageFromError(named.error, "Could not save that name.") };
  }
  if (formData.has("fieldResource")) {
    const linked = await supabase.rpc("install_set_field_resource", {
      p_profile: clean(formData.get("userId")),
      p_choice: opened.choice,
    });
    if (linked.error) {
      if (opened.createdId) await discardFieldEngineer(opened.createdId);
      return { message: messageFromError(linked.error, "Could not link that engineer.") };
    }
  }
  revalidatePath("/settings/workspace/users");
  return null;
}

function engineerDraftProblem(formData: FormData) {
  if (clean(formData.get("fieldResource")) !== "new") return null;
  return newEngineerProblem({
    name: clean(formData.get("engineerName")),
    role: clean(formData.get("engineerRole")),
  }, []);
}

export async function inviteWorkspaceUser(_prev: WorkspaceFormState, formData: FormData): Promise<WorkspaceFormState> {
  await requireWorkspaceAdmin();
  const problem = nameProblem(formData) ?? engineerDraftProblem(formData) ?? installsChoiceProblem(formData);
  if (problem) return { message: problem };
  const email = clean(formData.get("email"));
  const names = personName(clean(formData.get("firstName")), clean(formData.get("lastName")));
  if (!names) return { message: "Enter a first and last name." };
  const opened = await openNewEngineer(formData);
  if (opened.message) return { message: opened.message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("workspace_prepare_invite", {
    p_email: email,
    p_first_name: names.firstName,
    p_last_name: names.lastName,
    p_workspace_role: clean(formData.get("workspaceRole")),
  });
  if (error) {
    if (opened.createdId) await discardFieldEngineer(opened.createdId);
    return { message: messageFromError(error, "We could not save that invite.") };
  }
  const prepared = (data ?? {}) as { already_registered?: boolean; user_id?: string | null };
  const applied = await supabase.rpc("install_apply_invite", {
    p_email: email,
    p_team_ids: formData.getAll("teamId").map(String).filter(Boolean),
    p_choice: opened.choice,
  });
  if (applied.error) {
    if (opened.createdId) await discardFieldEngineer(opened.createdId);
    return { message: messageFromError(applied.error, "Could not link that engineer.") };
  }
  if (!prepared.already_registered) {
    if (!hasServiceRole()) return { message: "Their access is saved, but sending the invite email needs SUPABASE_SERVICE_ROLE_KEY on the server." };
    const service = createAdminClient();
    if (!service) return { message: "Their access is saved, but sending the invite email needs SUPABASE_SERVICE_ROLE_KEY on the server." };
    const { error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
      data: { first_name: names.firstName, last_name: names.lastName, full_name: `${names.firstName} ${names.lastName}` },
      redirectTo: authConfirmRedirect(passwordSetupPath()),
    });
    if (inviteError && !inviteError.message.toLowerCase().includes("already")) {
      return { message: "Their access is saved, but the invite email was not sent. Try again in a moment." };
    }
  }
  revalidatePath("/settings/workspace/users");
  return null;
}

export async function setRecordOwner(_prev: WorkspaceFormState, formData: FormData): Promise<WorkspaceFormState> {
  await requireWorkspaceAdmin();
  const supabase = await createClient();
  const owner = clean(formData.get("ownerId"));
  const { error } = await supabase.rpc("set_record_owner", {
    p_kind: clean(formData.get("kind")),
    p_id: clean(formData.get("recordId")),
    p_owner: owner || null,
  });
  if (error) return { message: messageFromError(error, "Could not save the owner.") };
  const recordId = clean(formData.get("recordId"));
  revalidatePath("/operations/jobs");
  revalidatePath(`/operations/jobs/${recordId}`);
  revalidatePath("/operations/installs");
  revalidatePath(`/operations/installs/${recordId}`);
  revalidatePath("/sales/installs");
  revalidatePath(`/sales/installs/${recordId}`);
  return null;
}

export async function deleteWorkspaceUser(_prev: WorkspaceFormState, formData: FormData): Promise<WorkspaceFormState> {
  await requireWorkspaceAdmin();
  const userId = clean(formData.get("userId"));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_delete_user", { p_profile: userId });
  if (error) return { message: messageFromError(error, "Could not delete that user.") };
  const mode = (data as { mode?: string } | null)?.mode;
  if (!hasServiceRole()) {
    return { message: mode === "hard"
      ? "The account is ready to remove, but signing them out needs SUPABASE_SERVICE_ROLE_KEY on the server."
      : "They are removed from Pulse, but blocking sign-in needs SUPABASE_SERVICE_ROLE_KEY on the server." };
  }
  const service = createAdminClient();
  if (!service) {
    return { message: "They are removed from Pulse, but blocking sign-in needs SUPABASE_SERVICE_ROLE_KEY on the server." };
  }
  if (mode === "hard") {
    const removed = await service.auth.admin.deleteUser(userId);
    if (removed.error) return { message: "Could not remove that sign-in. Try again in a moment." };
  } else {
    const banned = await service.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
    if (banned.error) return { message: "They are removed from Pulse, but the sign-in ban did not save. Try again in a moment." };
  }
  revalidatePath("/settings/workspace/users");
  return { message: mode === "hard" ? "User deleted." : "User deleted. Their name stays on past records." };
}

export async function resendWorkspaceInvite(formData: FormData) {
  await requireWorkspaceAdmin();
  if (!hasServiceRole()) return;
  const service = createAdminClient();
  if (!service) return;
  await service.auth.admin.inviteUserByEmail(clean(formData.get("email")), {
    redirectTo: authConfirmRedirect(passwordSetupPath()),
  });
}
