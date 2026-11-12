import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { DirectoryUser, ModuleAccess } from "@/lib/types";

type DirectoryRow = Omit<DirectoryUser, "modules"> & {
  module_access: ModuleAccess[] | null;
};

export async function listDirectory(): Promise<DirectoryUser[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, email, first_name, last_name, full_name, role, is_active, access_granted, last_sign_in_at, created_at, updated_at, module_access ( module_id, enabled )",
    )
    .order("last_name")
    .order("first_name");

  if (error) {
    console.error(error);
    throw new Error("Could not load users");
  }

  return ((data ?? []) as DirectoryRow[]).map((row) => {
    const { module_access: modules, ...profile } = row;
    return { ...profile, modules: modules ?? [] };
  });
}
