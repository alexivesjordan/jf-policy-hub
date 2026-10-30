"use server";

import { revalidatePath } from "next/cache";
import { requireRole, requestOrigin } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import { hasServiceRole } from "@/lib/env";
import { messageFromError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";
import { slugify } from "@/lib/utils";

function clean(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function asRole(value: string): Role | null {
  if (value === "admin" || value === "approver" || value === "staff") return value;
  return null;
}

export async function inviteUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireRole(["admin"]);
  const email = clean(formData.get("email")).toLowerCase();
  const fullName = clean(formData.get("fullName"));
  const role = asRole(clean(formData.get("role")));

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: "Enter a valid email address." };
  }
  if (!role) return { ok: false, message: "Choose a role." };
  if (!hasServiceRole()) {
    return { ok: false, message: "Invites need SUPABASE_SERVICE_ROLE_KEY on the server." };
  }

  const service = createAdminClient();
  if (!service) {
    return { ok: false, message: "Invites need SUPABASE_SERVICE_ROLE_KEY on the server." };
  }

  const origin = await requestOrigin();
  const { data, error } = await service.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: `${origin}/auth/callback`,
  });

  if (error || !data.user) {
    const friendly = error?.message?.toLowerCase().includes("already")
      ? "That person already has an account."
      : "We could not send the invite. Check the email address and try again.";
    if (error) console.error(error);
    return { ok: false, message: friendly };
  }

  const supabase = await createClient();
  const assignedRole = email === "alex.ives@jordanfitness.com" ? "admin" : role;
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ role: assignedRole, full_name: fullName || null })
    .eq("id", data.user.id);

  if (updateError) {
    return { ok: false, message: messageFromError(updateError, "The invite was sent, but the role was not saved.") };
  }

  await supabase.rpc("log_event", {
    p_action: "user.invited",
    p_entity_type: "profile",
    p_entity_id: data.user.id,
    p_policy_id: null,
    p_details: { email, role: assignedRole, invited_by: admin.id },
  });

  revalidatePath("/admin/people");
  return { ok: true, message: `Invite sent to ${email}.` };
}

export async function updateUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireRole(["admin"]);
  const userId = clean(formData.get("userId"));
  const role = asRole(clean(formData.get("role")));
  const active = formData.get("isActive") === "yes";
  if (!role) return { ok: false, message: "Choose a role." };

  if (userId === me.id && !active) {
    return { ok: false, message: "You cannot deactivate your own account." };
  }
  if (userId === me.id && role !== "admin") {
    return { ok: false, message: "You cannot remove your own administrator access." };
  }

  const supabase = await createClient();
  const { data: target, error: targetError } = await supabase
    .from("profiles")
    .select("id, role, is_active, email")
    .eq("id", userId)
    .maybeSingle();

  if (targetError || !target) return { ok: false, message: "That person could not be found." };

  const current = target as { id: string; role: Role; is_active: boolean; email: string };
  if ((current.role === "admin" && role !== "admin") || (current.role === "admin" && current.is_active && !active)) {
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("is_active", true)
      .neq("id", userId);
    if ((count ?? 0) === 0) {
      return { ok: false, message: "Keep at least one active administrator." };
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      role: current.email === "alex.ives@jordanfitness.com" ? "admin" : role,
      is_active: active,
    })
    .eq("id", userId);

  if (error) return { ok: false, message: messageFromError(error, "We could not update that person.") };

  revalidatePath("/admin/people");
  return { ok: true, message: "Saved." };
}

export async function createCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["admin"]);
  const name = clean(formData.get("name"));
  const slug = slugify(name);
  if (!name || !slug) return { ok: false, message: "Enter a category name." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .insert({ name, slug, auto_apply_allowed: false })
    .select("id")
    .single();

  if (error || !data) {
    const duplicate = error?.message?.toLowerCase().includes("duplicate");
    return {
      ok: false,
      message: duplicate ? "That category already exists." : "We could not add that category.",
    };
  }

  await supabase.rpc("log_event", {
    p_action: "category.created",
    p_entity_type: "category",
    p_entity_id: (data as { id: string }).id,
    p_policy_id: null,
    p_details: { name, slug },
  });

  revalidatePath("/admin/categories");
  revalidatePath("/policies");
  return { ok: true, message: `${name} added.` };
}

export async function setAutoApply(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["admin"]);
  const id = clean(formData.get("categoryId"));
  const allowed = formData.get("allowed") === "yes";
  const supabase = await createClient();
  const { error } = await supabase.from("categories").update({ auto_apply_allowed: allowed }).eq("id", id);
  if (error) return { ok: false, message: messageFromError(error, "We could not update that category.") };

  await supabase.rpc("log_event", {
    p_action: "category.updated",
    p_entity_type: "category",
    p_entity_id: id,
    p_policy_id: null,
    p_details: { auto_apply_allowed: allowed },
  });

  revalidatePath("/admin/categories");
  return {
    ok: true,
    message: allowed
      ? "Low-severity suggestions in this category will now be applied automatically."
      : "Automatic updates are off for this category.",
  };
}
