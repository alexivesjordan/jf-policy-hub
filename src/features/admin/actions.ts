"use server";

import { revalidatePath } from "next/cache";
import { isCompanyEmail, normaliseEmail } from "@/lib/access";
import { requireRole } from "@/lib/auth";
import { authConfirmRedirect } from "@/lib/site-url";
import { passwordSetupPath } from "@/lib/auth-link";
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

function revalidateUsers() {
  revalidatePath("/admin/users");
  revalidatePath("/admin/people");
}

export async function inviteUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["admin"]);
  const email = normaliseEmail(clean(formData.get("email")));
  const fullName = clean(formData.get("fullName"));
  const role = asRole(clean(formData.get("role")));
  const peopleEnabled = formData.get("peopleEnabled") === "yes";

  if (!isCompanyEmail(email)) {
    return { ok: false, message: "Use a @jordanfitness.com email address." };
  }
  if (!role) return { ok: false, message: "Choose a role." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_prepare_invite", {
    p_email: email,
    p_full_name: fullName,
    p_role: role,
    p_people_enabled: peopleEnabled,
  });

  if (error) {
    return { ok: false, message: messageFromError(error, "We could not save that invite.") };
  }

  const prepared = (data ?? {}) as { already_registered?: boolean; role?: Role };
  revalidateUsers();

  if (prepared.already_registered) {
    return {
      ok: true,
      message: `${email} already has an account. Their role and access are updated. If they have not set a password, they can use Forgot password.`,
    };
  }

  if (!hasServiceRole()) {
    return {
      ok: false,
      message: "Their access is saved, but sending the invite email needs SUPABASE_SERVICE_ROLE_KEY on the server.",
    };
  }

  const service = createAdminClient();
  if (!service) {
    return {
      ok: false,
      message: "Their access is saved, but sending the invite email needs SUPABASE_SERVICE_ROLE_KEY on the server.",
    };
  }

  const { error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: authConfirmRedirect(passwordSetupPath()),
  });

  if (inviteError) {
    const already = inviteError.message.toLowerCase().includes("already");
    if (already) {
      await supabase.rpc("admin_prepare_invite", {
        p_email: email,
        p_full_name: fullName,
        p_role: role,
        p_people_enabled: peopleEnabled,
      });
      revalidateUsers();
      return {
        ok: true,
        message: `${email} already has an account. Their role and access are updated. If they have not set a password, they can use Forgot password.`,
      };
    }
    console.error(inviteError);
    return {
      ok: false,
      message: "Their access is saved, but the invite email was not sent. Try again in a moment.",
    };
  }

  return {
    ok: true,
    message: `Invite sent to ${email}. They choose a password from that email, and a later sign-in uses the same account.`,
  };
}

export async function updateUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["admin"]);
  const userId = clean(formData.get("userId"));
  const role = asRole(clean(formData.get("role")));
  const active = formData.get("isActive") === "yes";
  const peopleEnabled = formData.get("peopleEnabled") === "yes";
  if (!role) return { ok: false, message: "Choose a role." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_member", {
    p_user_id: userId,
    p_role: role,
    p_is_active: active,
    p_people_enabled: peopleEnabled,
  });

  if (error) return { ok: false, message: messageFromError(error, "We could not update that person.") };

  revalidateUsers();
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
