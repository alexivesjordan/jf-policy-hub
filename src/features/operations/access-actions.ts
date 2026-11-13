"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { hasLevel } from "@/lib/module-guard";
import { requireOperationsUser } from "@/lib/auth";
import { getOfficeContext } from "@/features/operations/queries";
import { accessMediaBytesMatch, accessMediaPathOk, planAccessMediaUpload, readStoredObjectHead, storedAccessMediaOk } from "@/lib/pulse/access-upload";
import { storePulseFile } from "@/lib/pulse/files";
import { pulseStoragePath } from "@/lib/pulse/prepare-upload";
import { hashPulseToken } from "@/lib/pulse/token-hash";
import { createTokenLink } from "@/lib/pulse/tokens";
import { createAdminClient } from "@/lib/supabase/admin";
import { messageFromError } from "@/lib/errors";
import type { ActionState } from "@/lib/action-state";

export async function createAccessLink(_state: ActionState, formData: FormData): Promise<ActionState & { path?: string }> {
  await requireOperationsUser();
  const context = await getOfficeContext();
  if (!hasLevel(context.operations, "edit", context.is_owner)) {
    return { ok: false, message: "You need edit access on Operations to send an access link." };
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
  const hash = hashPulseToken(token);
  if (!hash) return { ok: false, message: "That link is not valid." };
  const name = String(formData.get("acceptedName") ?? "").trim();
  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Supabase is not configured." };

  const installPreview = await admin.rpc("install_access_preview", { p_token_hash: hash });
  const install = installPreview.data as { install_id?: string; submitted?: boolean } | null;
  if (install?.install_id) {
    if (!install.submitted && formData.get("accept") !== "yes") {
      return { ok: false, message: "Tick the terms box after you have read the charges." };
    }
    if (!install.submitted && !name) return { ok: false, message: "Add your name." };
    const files = [
      ...formData.getAll("photos"),
      ...formData.getAll("videos"),
    ].filter((item): item is File => item instanceof File && item.size > 0);
    const media = mediaIdsFrom(formData);
    for (const file of files.slice(0, 8)) {
      const stored = await storeAccessFile(file, "installs", install.install_id);
      if (!stored.ok) return stored;
      media.push(stored.fileId);
    }
    if (install.submitted && media.length === 0 && !name) {
      return { ok: false, message: "Add a photo or video." };
    }
    const headerList = await headers();
    const saved = await admin.rpc("install_save_access", {
      p_token_hash: hash,
      p_answers: install.submitted ? null : answersFrom(formData),
      p_media_ids: media,
      p_accepted_name: name,
      p_user_agent: headerList.get("user-agent"),
    });
    if (saved.error) return { ok: false, message: messageFromError(saved.error, "Could not save the form.") };
    return { ok: true, message: "Access details received. You can use this link again to add photos or videos." };
  }

  const preview = await admin.rpc("orbit_access_preview", { p_token_hash: hash });
  if (preview.error || !preview.data) {
    return { ok: false, message: messageFromError(preview.error, "That link is not valid.") };
  }
  if (formData.get("accept") !== "yes") return { ok: false, message: "Tick the terms box after you have read the charges." };
  if (!name) return { ok: false, message: "Add your name." };
  const jobId = (preview.data as { job_id: string; terms: { id: string } | null }).job_id;
  const termsId = (preview.data as { terms: { id: string } | null }).terms?.id ?? null;
  const answers = answersFrom(formData);

  const media = mediaIdsFrom(formData);
  const files = formData.getAll("photos").filter((item): item is File => item instanceof File && item.size > 0);
  for (const file of files.slice(0, 8)) {
    const stored = await storeAccessFile(file, "install_jobs", jobId);
    if (!stored.ok) return stored;
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

const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mediaIdsFrom(formData: FormData) {
  return formData.getAll("mediaIds").map((value) => String(value)).filter((value) => FILE_ID.test(value));
}

async function storeAccessFile(file: File, entityTable: string, entityId: string) {
  try {
    const stored = await storePulseFile({
      bucket: "access-media",
      mimeType: file.type || "image/jpeg",
      bytes: Buffer.from(await file.arrayBuffer()),
      uploadedBy: null,
      entitySchema: "ops",
      entityTable,
      entityId,
      kind: file.type.startsWith("video/") ? "video" : "photo",
    });
    return { ok: true as const, fileId: stored.fileId };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "Could not store that file." };
  }
}

export async function prepareAccessMediaUpload(token: string, mimeType: string, byteSize: number) {
  const hash = hashPulseToken(token);
  if (!hash) return { ok: false as const, message: "That link is not valid." };
  const plan = planAccessMediaUpload(mimeType, byteSize);
  if (!plan.ok) return plan;
  const admin = createAdminClient();
  if (!admin) return { ok: false as const, message: "Supabase is not configured." };
  const preview = await admin.rpc("install_access_preview", { p_token_hash: hash });
  const installId = (preview.data as { install_id?: string } | null)?.install_id;
  if (!installId) return { ok: false as const, message: "That link is not valid." };
  const path = pulseStoragePath("ops", installId, plan.extension);
  const signed = await admin.storage.from("access-media").createSignedUploadUrl(path);
  if (signed.error || !signed.data) return { ok: false as const, message: "Could not start that upload." };
  return {
    ok: true as const,
    bucket: "access-media" as const,
    path: signed.data.path,
    token: signed.data.token,
    signedUrl: signed.data.signedUrl,
    kind: plan.kind,
  };
}

export async function finishAccessMediaUpload(token: string, path: string) {
  const hash = hashPulseToken(token);
  if (!hash) return { ok: false as const, message: "That link is not valid." };
  const admin = createAdminClient();
  if (!admin) return { ok: false as const, message: "Supabase is not configured." };
  const preview = await admin.rpc("install_access_preview", { p_token_hash: hash });
  const installId = (preview.data as { install_id?: string } | null)?.install_id;
  if (!installId || !accessMediaPathOk(installId, path)) return { ok: false as const, message: "That file path is not allowed." };
  const info = await admin.storage.from("access-media").info(path);
  if (info.error || info.data?.size == null || !info.data.contentType) {
    return { ok: false as const, message: "Upload the file before saving it." };
  }
  const mimeType = info.data.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const plan = storedAccessMediaOk(path, mimeType, info.data.size);
  if (!plan.ok) {
    await admin.storage.from("access-media").remove([path]);
    return plan;
  }
  const head = await storedObjectHead(admin, path);
  if (!head || !accessMediaBytesMatch(mimeType, head)) {
    await admin.storage.from("access-media").remove([path]);
    return { ok: false as const, message: "That file type is not allowed." };
  }
  const registered = await admin.rpc("orbit_register_file", {
    p_bucket: "access-media",
    p_storage_path: path,
    p_mime_type: mimeType,
    p_byte_size: info.data.size,
    p_checksum: null,
    p_uploaded_by: null,
    p_entity_schema: "ops",
    p_entity_table: "installs",
    p_entity_id: installId,
    p_kind: plan.kind,
  });
  if (registered.error || !registered.data) return { ok: false as const, message: "Could not register that file." };
  return { ok: true as const, fileId: registered.data as string };
}

async function storedObjectHead(admin: NonNullable<ReturnType<typeof createAdminClient>>, path: string) {
  const signed = await admin.storage.from("access-media").createSignedUrl(path, 60);
  if (signed.error || !signed.data?.signedUrl) return null;
  try {
    const response = await fetch(signed.data.signedUrl, {
      headers: { Range: "bytes=0-31" },
      signal: AbortSignal.timeout(10_000),
    });
    return readStoredObjectHead(response);
  } catch {
    return null;
  }
}

function answersFrom(formData: FormData) {
  return {
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
}

function numberOrNull(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}
