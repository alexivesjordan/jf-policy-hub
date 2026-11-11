"use server";

import { revalidatePath } from "next/cache";
import { personName } from "@/lib/names";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { messageFromError } from "@/lib/errors";
import { redirect } from "next/navigation";

export async function updateOwnName(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/account/name");
  const names = personName(String(formData.get("firstName") ?? ""), String(formData.get("lastName") ?? ""));
  if (!names) throw new Error("Enter a first and last name.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_person_name", {
    p_profile: profile.id,
    p_first_name: names.firstName,
    p_last_name: names.lastName,
  });
  if (error) throw new Error(messageFromError(error, "Could not save that name."));
  revalidatePath("/account/name");
  revalidatePath("/");
  redirect("/account/name");
}
