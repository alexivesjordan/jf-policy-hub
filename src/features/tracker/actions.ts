"use server";

import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { messageFromError } from "@/lib/errors";
import { isFixtureMode } from "@/lib/env";
import { requireSalesUser } from "@/lib/auth";
import { preparePulseUpload, pulseStoragePath, PulseFileError } from "@/lib/pulse/prepare-upload";
import { generatePulseToken } from "@/lib/pulse/token-hash";
import { siteUrl } from "@/lib/site-url";
import { FIXTURE_TRACK_TOKEN } from "@/lib/tracker/fixture";
import { readTrackerSale, type TrackerSnapshot } from "@/lib/tracker/snapshot";
import { cin7Get } from "@/lib/cin7/transport";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type TrackerAction = { ok: boolean; message: string; link?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_NUMBER = /^[A-Za-z0-9-]{1,40}$/;

function fail(message: string): TrackerAction {
  return { ok: false, message };
}

function trackUrl(token: string) {
  return `${siteUrl()}/track/${token}`;
}

function liveGet() {
  const accountId = process.env.CIN7_ACCOUNT_ID?.trim() ?? "";
  const applicationKey = process.env.CIN7_APPLICATION_KEY?.trim() ?? "";
  if (!accountId || !applicationKey) return null;
  return (path: "sale" | "saleList" | "product" | "customer", query: Record<string, string>) =>
    cin7Get({ accountId, applicationKey, path, query });
}

async function confirmedOrder(orderNumber: string): Promise<TrackerSnapshot | TrackerAction> {
  const get = liveGet();
  if (!get) return fail("Cin7 is not connected.");
  try {
    const snapshot = await readTrackerSale(orderNumber, get);
    if (!snapshot) return fail("No order with that number.");
    return snapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("rate limit")) return fail("Cin7 rate limit. Try again in a minute.");
    if (message.includes("More than one")) return fail("More than one Cin7 sale has that order number.");
    return fail("That order could not be read.");
  }
}

export async function createOrderTracker(orderNumber: string): Promise<TrackerAction> {
  await requireSalesUser();
  const number = orderNumber.trim();
  if (!ORDER_NUMBER.test(number)) return fail("Enter an order number such as SO-00490.");
  if (isFixtureMode()) return { ok: true, message: "Link created.", link: trackUrl(FIXTURE_TRACK_TOKEN) };

  const snapshot = await confirmedOrder(number);
  if ("ok" in snapshot) return snapshot;
  const issued = generatePulseToken();
  const supabase = await createClient();
  const created = await supabase.rpc("order_tracker_create", {
    p_order_number: snapshot.orderNumber,
    p_cin7_sale_id: snapshot.saleId,
    p_token_hash: issued.hashHex,
  });
  if (created.error || !created.data) return fail(messageFromError(created.error, "That tracking link could not be created."));

  const admin = createAdminClient();
  if (admin) {
    const saved = await admin.rpc("order_tracker_save_snapshot", { p_token_hash: issued.hashHex, p_snapshot: snapshot });
    if (saved.error) console.error("tracker snapshot save failed", saved.error.code);
  }
  revalidatePath("/sales/orders");
  return { ok: true, message: "Link created.", link: trackUrl(issued.token) };
}

export async function revokeOrderTracker(id: string): Promise<TrackerAction> {
  await requireSalesUser();
  if (!UUID.test(id)) return fail("That tracking link was not found.");
  if (isFixtureMode()) return { ok: true, message: "Link revoked." };
  const supabase = await createClient();
  const result = await supabase.rpc("order_tracker_revoke", { p_id: id });
  if (result.error) return fail(messageFromError(result.error, "That tracking link could not be revoked."));
  revalidatePath("/sales/orders");
  return { ok: true, message: "Link revoked." };
}

export async function regenerateOrderTracker(id: string): Promise<TrackerAction> {
  await requireSalesUser();
  if (!UUID.test(id)) return fail("That tracking link was not found.");
  if (isFixtureMode()) return { ok: true, message: "Link regenerated.", link: trackUrl(FIXTURE_TRACK_TOKEN) };
  const issued = generatePulseToken();
  const supabase = await createClient();
  const result = await supabase.rpc("order_tracker_regenerate", { p_id: id, p_token_hash: issued.hashHex });
  if (result.error) return fail(messageFromError(result.error, "That tracking link could not be created."));
  revalidatePath("/sales/orders");
  return { ok: true, message: "Link regenerated.", link: trackUrl(issued.token) };
}

export async function setTrackerPhotoVisible(id: string, visible: boolean): Promise<TrackerAction> {
  await requireSalesUser();
  if (!UUID.test(id)) return fail("That photo was not found.");
  if (isFixtureMode()) return { ok: true, message: visible ? "Photo shown." : "Photo hidden." };
  const supabase = await createClient();
  const result = await supabase.rpc("order_tracker_photo_visible", { p_id: id, p_visible: visible });
  if (result.error) return fail(messageFromError(result.error, "That photo could not be updated."));
  revalidatePath("/sales/orders");
  return { ok: true, message: visible ? "Photo shown." : "Photo hidden." };
}

export async function addTrackerPhoto(formData: FormData): Promise<TrackerAction> {
  const profile = await requireSalesUser();
  const trackerId = String(formData.get("trackerId") ?? "");
  const caption = String(formData.get("caption") ?? "").trim();
  const file = formData.get("photo");
  if (!UUID.test(trackerId)) return fail("That tracking link was not found.");
  if (caption.length > 200) return fail("Keep the caption under 200 characters.");
  if (!(file instanceof File) || file.size === 0) return fail("Choose a photo.");
  if (isFixtureMode()) return { ok: true, message: "Photo added. It stays hidden until you show it." };

  let prepared;
  try {
    prepared = await preparePulseUpload("qc", file.type || "application/octet-stream", Buffer.from(await file.arrayBuffer()));
  } catch (error) {
    if (error instanceof PulseFileError) return fail(error.message);
    return fail("That photo could not be stored.");
  }

  const admin = createAdminClient();
  if (!admin) return fail("That photo could not be stored.");
  const storagePath = pulseStoragePath("ops", trackerId, prepared.extension);
  const uploaded = await admin.storage.from("qc").upload(storagePath, prepared.bytes, { contentType: prepared.mimeType, upsert: false });
  if (uploaded.error) return fail("That photo could not be stored.");

  const registered = await admin.rpc("orbit_register_file", {
    p_bucket: "qc",
    p_storage_path: storagePath,
    p_mime_type: prepared.mimeType,
    p_byte_size: prepared.bytes.length,
    p_checksum: createHash("sha256").update(prepared.bytes).digest("hex"),
    p_uploaded_by: profile.id,
    p_entity_schema: "ops",
    p_entity_table: "order_trackers",
    p_entity_id: trackerId,
    p_kind: "qc",
  });
  if (registered.error || !registered.data) {
    await admin.storage.from("qc").remove([storagePath]);
    return fail("That photo could not be stored.");
  }

  const supabase = await createClient();
  const added = await supabase.rpc("order_tracker_add_photo", {
    p_tracker_id: trackerId,
    p_file_id: registered.data,
    p_caption: caption,
  });
  if (added.error || !added.data) {
    await admin.storage.from("qc").remove([storagePath]);
    return fail(messageFromError(added.error, "That photo could not be stored."));
  }
  revalidatePath("/sales/orders");
  return { ok: true, message: "Photo added. It stays hidden until you show it." };
}
