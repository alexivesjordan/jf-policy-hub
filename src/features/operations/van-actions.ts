"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspaceAdmin } from "@/lib/auth";
import { messageFromError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

function clean(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

export async function saveVan(_prev: { message: string } | null, formData: FormData) {
  await requireWorkspaceAdmin();
  const id = clean(formData.get("id"));
  const supabase = await createClient();
  const saved = await supabase.rpc("install_save_van", {
    p_id: id || null,
    p_registration: clean(formData.get("registration")),
    p_name: clean(formData.get("name")),
    p_active: formData.get("active") !== "no",
  });
  if (saved.error) return { message: messageFromError(saved.error, "Could not save that van.") };
  revalidatePath("/operations/vans");
  return null;
}
