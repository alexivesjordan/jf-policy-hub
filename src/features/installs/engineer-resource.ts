"use server";

import { messageFromError } from "@/lib/errors";
import { newEngineerProblem } from "@/lib/installs/new-engineer";
import { createClient } from "@/lib/supabase/server";

/** Create one installer or helper. Workspace admin only. HR can call this later. */
export async function createFieldEngineer(input: { name: string; role: string }) {
  const problem = newEngineerProblem(input, []);
  if (problem) return { ok: false as const, message: problem };
  const supabase = await createClient();
  const created = await supabase.rpc("install_create_field_engineer", {
    p_name: input.name,
    p_role: input.role,
  });
  if (created.error || typeof created.data !== "string") {
    return { ok: false as const, message: messageFromError(created.error, "Could not add that engineer.") };
  }
  return { ok: true as const, id: created.data };
}

/** Remove a resource that was created for an invite that did not finish. */
export async function discardFieldEngineer(id: string) {
  const supabase = await createClient();
  await supabase.rpc("install_discard_new_engineer", { p_id: id });
}
