import "server-only";

import { cin7Get } from "@/lib/cin7/transport";
import { isFixtureMode } from "@/lib/env";
import { FIXTURE_ORDER, fixturePublicModel, fixtureSnapshot, fixtureStaffLinks, FIXTURE_TRACK_TOKEN } from "@/lib/tracker/fixture";
import type { StaffLink, StaffPhoto } from "@/lib/tracker/load-types";
import { buildPublicModel, type PublicTrackerModel } from "@/lib/tracker/model";
import { hashPulseToken } from "@/lib/pulse/token-hash";
import { snapshotIsFresh } from "@/lib/tracker/stages";
import { parseTrackerSnapshot, readTrackerSale, type TrackerSnapshot } from "@/lib/tracker/snapshot";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const SIGNED_URL_SECONDS = 60;

export type StaffSearch =
  | { state: "idle" }
  | { state: "invalid" }
  | { state: "offline" }
  | { state: "missing" }
  | { state: "error"; message: string }
  | { state: "found"; snapshot: TrackerSnapshot; links: StaffLink[] };

export type PublicTracker =
  | { state: "missing" }
  | { state: "unavailable" }
  | { state: "ready"; model: PublicTrackerModel };

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function liveGet() {
  const accountId = process.env.CIN7_ACCOUNT_ID?.trim() ?? "";
  const applicationKey = process.env.CIN7_APPLICATION_KEY?.trim() ?? "";
  if (!accountId || !applicationKey) return null;
  return (path: "sale" | "saleList" | "product" | "customer", query: Record<string, string>) =>
    cin7Get({ accountId, applicationKey, path, query });
}

function cin7Failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("rate limit")) return "Cin7 rate limit. Try again in a minute.";
  if (message.includes("More than one")) return "More than one Cin7 sale has that order number.";
  if (message.includes("Enter an order number")) return "Enter an order number such as SO-00490.";
  return "That order could not be read.";
}

function staffLinks(value: unknown): StaffLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = record(entry);
    if (!row || !text(row.id) || !text(row.orderNumber)) return [];
    const status = row.status === "revoked" || row.status === "expired" || row.status === "active" ? row.status : "active";
    const photos: StaffPhoto[] = Array.isArray(row.photos)
      ? row.photos.flatMap((photo) => {
          const item = record(photo);
          if (!item || !text(item.id)) return [];
          return [{
            id: text(item.id) as string,
            caption: text(item.caption),
            visible: item.visible === true,
            sortOrder: typeof item.sortOrder === "number" ? item.sortOrder : 0,
            url: text(item.path),
          }];
        })
      : [];
    return [{
      id: text(row.id) as string,
      orderNumber: text(row.orderNumber) as string,
      status,
      createdAt: text(row.createdAt) ?? "",
      expiresOn: text(row.expiresOn) ?? "",
      viewCount: typeof row.viewCount === "number" ? row.viewCount : 0,
      lastViewedAt: text(row.lastViewedAt),
      photos,
    }];
  });
}

async function signPhotos(links: StaffLink[]) {
  const admin = createAdminClient();
  if (!admin) {
    return links.map((link) => ({ ...link, photos: link.photos.map((photo) => ({ ...photo, url: null })) }));
  }
  return Promise.all(links.map(async (link) => ({
    ...link,
    photos: await Promise.all(link.photos.map(async (photo) => {
      const path = photo.url;
      if (!path) return { ...photo, url: null };
      const signed = await admin.storage.from("qc").createSignedUrl(path, SIGNED_URL_SECONDS);
      return { ...photo, url: signed.data?.signedUrl ?? null };
    })),
  })));
}

export async function loadOrderTracking(query: string): Promise<StaffSearch> {
  const q = query.trim();
  if (!q) return { state: "idle" };
  if (!/^[A-Za-z0-9-]{1,40}$/.test(q)) return { state: "invalid" };
  if (isFixtureMode()) {
    if (q.toLowerCase() !== FIXTURE_ORDER.toLowerCase()) return { state: "missing" };
    return { state: "found", snapshot: fixtureSnapshot(), links: fixtureStaffLinks() };
  }

  const get = liveGet();
  if (!get) return { state: "offline" };
  let snapshot: TrackerSnapshot | null = null;
  try {
    snapshot = await readTrackerSale(q, get);
  } catch (error) {
    return { state: "error", message: cin7Failure(error) };
  }
  if (!snapshot) return { state: "missing" };

  const supabase = await createClient();
  const listed = await supabase.rpc("order_tracker_list", { p_order_number: snapshot.orderNumber });
  if (listed.error) return { state: "error", message: "Tracking links could not be loaded." };
  return { state: "found", snapshot, links: await signPhotos(staffLinks(listed.data)) };
}

async function refreshSnapshot(hash: string, orderNumber: string, saleId: string | null, current: TrackerSnapshot | null, snapshotAt: string | null) {
  if (snapshotIsFresh(snapshotAt) && current) return current;
  const get = liveGet();
  if (!get) return current;
  try {
    const next = await readTrackerSale(saleId || orderNumber, get);
    if (!next || next.orderNumber.toLowerCase() !== orderNumber.toLowerCase()) return current;
    const admin = createAdminClient();
    if (admin) {
      const saved = await admin.rpc("order_tracker_save_snapshot", { p_token_hash: hash, p_snapshot: next });
      if (saved.error) console.error("tracker snapshot save failed", saved.error.code);
    }
    return next;
  } catch (error) {
    console.error("tracker snapshot refresh failed", error instanceof Error ? error.message : "read failed");
    return current;
  }
}

export async function loadPublicTracker(token: string): Promise<PublicTracker> {
  if (isFixtureMode()) {
    if (token !== FIXTURE_TRACK_TOKEN) return { state: "missing" };
    return { state: "ready", model: fixturePublicModel(token) };
  }
  const hash = hashPulseToken(token);
  const admin = createAdminClient();
  if (!hash || !admin) return { state: "missing" };
  const opened = await admin.rpc("order_tracker_open", { p_token_hash: hash });
  if (opened.error || !opened.data) return { state: "missing" };
  const data = record(opened.data);
  const orderNumber = text(data?.orderNumber);
  if (!data || !orderNumber) return { state: "missing" };

  const current = parseTrackerSnapshot(data.snapshot);
  const snapshot = await refreshSnapshot(hash, orderNumber, text(data.saleId), current, text(data.snapshotAt));
  if (!snapshot) return { state: "unavailable" };

  const installRow = record(data.install);
  const install = installRow && text(installRow.status)
    ? { status: text(installRow.status) as string, startOn: text(installRow.startOn) }
    : null;
  const photos = Array.isArray(data.photos)
    ? data.photos.flatMap((photo) => {
        const row = record(photo);
        const id = text(row?.id);
        if (!id) return [];
        return [{ id, caption: text(row?.caption), src: `/api/track/media/${encodeURIComponent(token)}/${id}` }];
      })
    : [];

  return { state: "ready", model: buildPublicModel({ snapshot, install, photos }) };
}
