import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { accessRedirect } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import type { ModuleAccess, Profile, Role } from "@/lib/types";

const profileColumns =
  "id, email, full_name, role, is_active, access_granted, last_sign_in_at, created_at, updated_at";

export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data, error }, modules] = await Promise.all([
    supabase.from("profiles").select(profileColumns).eq("id", user.id).maybeSingle(),
    supabase.from("module_access").select("module_id, enabled").eq("profile_id", user.id),
  ]);

  if (error || !data) {
    if (error) console.error(error);
    return null;
  }

  const profile = data as Profile;
  if (modules.error) {
    console.error(modules.error);
    return profile;
  }

  profile.modules = (modules.data ?? []) as ModuleAccess[];
  return profile;
});

export async function requireUser() {
  const profile = await getCurrentProfile();
  const destination = accessRedirect(profile);
  if (destination) redirect(destination);
  return profile as Profile;
}

export async function requireRole(roles: Role[]) {
  const profile = await requireUser();
  if (!roles.includes(profile.role)) redirect("/dashboard");
  return profile;
}

export async function requestOrigin() {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  if (!host) return "http://localhost:3000";
  return `${proto}://${host}`;
}
