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
  const day = (name: string) => clean(formData.get(name)) || null;
  const saved = await supabase.rpc("install_save_van", {
    p_id: id || null,
    p_registration: clean(formData.get("registration")),
    p_name: clean(formData.get("name")),
    p_active: formData.get("active") !== "no",
    p_make_model: clean(formData.get("makeModel")) || null,
    p_mot_due: day("motDue"),
    p_tax_due: day("taxDue"),
    p_insurance_due: day("insuranceDue"),
    p_service_due: day("serviceDue"),
    p_notes: clean(formData.get("notes")) || null,
  });
  if (saved.error) return { message: messageFromError(saved.error, "Could not save that vehicle.") };
  revalidatePath("/operations/fleet");
  revalidatePath("/operations/vans");
  revalidatePath("/operations/schedule");
  return null;
}
