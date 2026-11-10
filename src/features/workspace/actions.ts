"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspaceAdmin, requestOrigin } from "@/lib/auth";
import { hasServiceRole } from "@/lib/env";
import { messageFromError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { PULSE_MODULE_IDS } from "@/lib/types";

function clean(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
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
  revalidatePath("/workspace/teams");
}

export async function deleteWorkspaceTeam(formData: FormData) {
  await requireWorkspaceAdmin();
  const supabase = await createClient();
  await supabase.rpc("workspace_delete_team", { p_id: clean(formData.get("teamId")) });
  revalidatePath("/workspace/teams");
}

export async function saveWorkspaceUser(formData: FormData) {
  await requireWorkspaceAdmin();
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
  if (error) throw new Error(messageFromError(error, "Could not save that user."));
  revalidatePath("/workspace/users");
}

export async function inviteWorkspaceUser(formData: FormData) {
  await requireWorkspaceAdmin();
  const email = clean(formData.get("email"));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("workspace_prepare_invite", {
    p_email: email,
    p_full_name: clean(formData.get("fullName")),
    p_workspace_role: clean(formData.get("workspaceRole")),
  });
  if (error) throw new Error(messageFromError(error, "We could not save that invite."));
  const prepared = (data ?? {}) as { already_registered?: boolean };
  if (!prepared.already_registered) {
    if (!hasServiceRole()) throw new Error("Their access is saved, but sending the invite email needs SUPABASE_SERVICE_ROLE_KEY on the server.");
    const service = createAdminClient();
    if (!service) throw new Error("Their access is saved, but sending the invite email needs SUPABASE_SERVICE_ROLE_KEY on the server.");
    const origin = await requestOrigin();
    const { error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
      data: { full_name: clean(formData.get("fullName")) },
      redirectTo: `${origin}/auth/confirm`,
    });
    if (inviteError && !inviteError.message.toLowerCase().includes("already")) {
      throw new Error("Their access is saved, but the invite email was not sent. Try again in a moment.");
    }
  }
  revalidatePath("/workspace/users");
}

export async function resendWorkspaceInvite(formData: FormData) {
  await requireWorkspaceAdmin();
  if (!hasServiceRole()) return;
  const service = createAdminClient();
  if (!service) return;
  const origin = await requestOrigin();
  await service.auth.admin.inviteUserByEmail(clean(formData.get("email")), {
    redirectTo: `${origin}/auth/confirm`,
  });
}
