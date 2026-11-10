"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireOperationsUser } from "@/lib/auth";
import { getOfficeContext } from "@/features/operations/queries";
import { storeOrbitFile } from "@/lib/orbit/files";
import { hashOrbitToken } from "@/lib/orbit/token-hash";
import { createTokenLink } from "@/lib/orbit/tokens";
import { createAdminClient } from "@/lib/supabase/admin";
import { messageFromError } from "@/lib/errors";
import type { ActionState } from "@/lib/action-state";

export async function createAccessLink(_state: ActionState, formData: FormData): Promise<ActionState & { path?: string }> {
  await requireOperationsUser();
  const context = await getOfficeContext();
  if (!context.is_owner && context.ops_role !== "install_lead" && context.ops_role !== "admin_owner") {
    return { ok: false, message: "Only the install lead can send an access link." };
  }
  const jobId = String(formData.get("jobId") ?? "");
  try {
    const created = await createTokenLink({
      purpose: "access_form",
      entitySchema: "ops",
      entityTable: "install_jobs",
      entityId: jobId,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 21).toISOString(),
    });
    return { ok: true, message: "Link ready. It is shown once on this page and is not stored in clear text.", path: `/access/${created.token}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not create the link." };
  }
}

export async function submitAccessForm(_state: ActionState, formData: FormData): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  const hash = hashOrbitToken(token);
  if (!hash) return { ok: false, message: "That link is not valid." };
  const accepted = formData.get("accept") === "yes";
  const name = String(formData.get("acceptedName") ?? "").trim();
  if (!accepted) return { ok: false, message: "Tick the terms box after you have read the charges." };
  if (!name) return { ok: false, message: "Add your name." };

  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Supabase is not configured." };

  const preview = await admin.rpc("orbit_access_preview", { p_token_hash: hash });
  if (preview.error || !preview.data) {
    return { ok: false, message: messageFromError(preview.error, "That link is not valid.") };
  }
  const jobId = (preview.data as { job_id: string; terms: { id: string } | null }).job_id;
  const termsId = (preview.data as { terms: { id: string } | null }).terms?.id ?? null;

  const answers = {
    groundFloor: formData.get("groundFloor") === "yes",
    floorNumber: numberOrNull(formData.get("floorNumber")),
    hasLift: formData.get("hasLift") === "yes",
    levelStepFree: formData.get("levelStepFree") === "yes",
    doubleDoorsOrClear: formData.get("doubleDoors") === "yes",
    openingWidthMm: numberOrNull(formData.get("openingWidth")),
    openingHeightMm: numberOrNull(formData.get("openingHeight")),
    tailLiftAdjacent: formData.get("tailLift") === "yes",
    dropZone: String(formData.get("dropZone") ?? "").trim() || null,
    startAtEight: formData.get("startAtEight") === "yes",
    roomClear: formData.get("roomClear") === "yes",
    floorFinished: formData.get("floorFinished") === "yes",
    townCentre: formData.get("townCentre") === "yes",
    siteHoursStart: String(formData.get("hoursStart") ?? "08:00"),
    siteHoursEnd: String(formData.get("hoursEnd") ?? "17:00"),
  };

  const media: string[] = [];
  const files = formData.getAll("photos").filter((item): item is File => item instanceof File && item.size > 0);
  for (const file of files.slice(0, 8)) {
    const stored = await storeOrbitFile({
      bucket: "access-media",
      mimeType: file.type || "image/jpeg",
      bytes: Buffer.from(await file.arrayBuffer()),
      uploadedBy: null,
      entitySchema: "ops",
      entityTable: "install_jobs",
      entityId: jobId,
      kind: "photo",
    });
    media.push(stored.fileId);
  }

  const headerList = await headers();
  const saved = await admin.rpc("orbit_submit_access_form", {
    p_token_hash: hash,
    p_answers: answers,
    p_media_ids: media,
    p_accepted_name: name,
    p_terms_version_id: termsId,
    p_user_agent: headerList.get("user-agent"),
  });
  if (saved.error) return { ok: false, message: messageFromError(saved.error, "Could not save the form.") };
  revalidatePath(`/operations/jobs/${jobId}/access`);
  return { ok: true, message: "Access details received. Jordan will confirm any extra charges before the install is booked." };
}

function numberOrNull(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}
