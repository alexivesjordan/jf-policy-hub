import { formatDate } from "@/lib/format";
import type { TrackerSnapshot } from "@/lib/tracker/snapshot";

export const TRACKER_SNAPSHOT_TTL_MS = 15 * 60 * 1000;

export const TRACKER_STAGE_IDS = ["confirmed", "preparing", "checked", "dispatched", "install_booked", "installed"] as const;

export type TrackerStageId = (typeof TRACKER_STAGE_IDS)[number];

export type TrackerStageState = "done" | "current" | "upcoming" | "skipped";

export type TrackerStage = {
  id: TrackerStageId;
  label: string;
  state: TrackerStageState;
  detail: string | null;
};

export type TrackerInstall = {
  status: string;
  startOn: string | null;
};

const STAGE_LABELS: Record<TrackerStageId, string> = {
  confirmed: "Order confirmed",
  preparing: "Being prepared",
  checked: "Checked",
  dispatched: "Dispatched",
  install_booked: "Install booked",
  installed: "Installed",
};

const CARRIERS: Record<string, string> = {
  FEDI: "FedEx",
  FEDEX: "FedEx",
  DHL: "DHL",
  UPS: "UPS",
  TNT: "TNT",
  DPD: "DPD",
  EUROPA: "Europa",
};

const DEAD = new Set(["", "DRAFT", "VOIDED", "VOID", "ESTIMATING", "ESTIMATED"]);
const PREPARED = new Set(["ORDERED", "BACKORDERED", "COMPLETED", "INVOICING", "INVOICED", "CLOSED"]);
const LIVE_INSTALL = new Set(["booked", "scheduled", "in_progress", "completed"]);

/** A 15 minute cache. Age equal to the limit is ready to refresh. */
export function snapshotIsFresh(snapshotAt: string | null | undefined, now = Date.now()) {
  if (!snapshotAt) return false;
  const then = Date.parse(snapshotAt);
  if (!Number.isFinite(then)) return false;
  return now - then < TRACKER_SNAPSHOT_TTL_MS;
}

/** Known carrier names only. Short account codes stay off the customer page. */
export function carrierName(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const mapped = CARRIERS[trimmed.toUpperCase()];
  if (mapped) return mapped;
  if (/^[A-Z0-9]{2,6}$/.test(trimmed)) return null;
  return trimmed;
}

export function trackerDay(value: string | null | undefined): { iso: string; label: string } | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (!match) return null;
  let iso = match[1];
  if (!/T00:00:00/.test(value) && value.length > 10) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      iso = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/London",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(parsed));
    }
  }
  const label = formatDate(iso);
  if (label === "Not set") return null;
  return { iso, label };
}

export function londonWhen(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function upper(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase();
}

function isConfirmed(snapshot: TrackerSnapshot) {
  const status = upper(snapshot.status);
  if (DEAD.has(status)) return false;
  if (status === "ORDERING" || PREPARED.has(status)) return true;
  return upper(snapshot.orderStatus) === "AUTHORISED";
}

function progressStarted(value: string | null, idle: string[]) {
  const status = upper(value);
  if (!status || idle.includes(status)) return false;
  return true;
}

function isPreparing(snapshot: TrackerSnapshot) {
  if (PREPARED.has(upper(snapshot.status))) return true;
  if (upper(snapshot.orderStatus) === "AUTHORISED") return true;
  if (progressStarted(snapshot.pickingStatus, ["NOT AVAILABLE", "NOT PICKED"])) return true;
  if (progressStarted(snapshot.packingStatus, ["NOT AVAILABLE", "NOT PACKED"])) return true;
  return false;
}

function isDispatched(snapshot: TrackerSnapshot) {
  const shipping = upper(snapshot.shippingStatus);
  const fulfilment = upper(snapshot.fulfilmentStatus);
  if (shipping === "SHIPPED" || shipping === "PARTIALLY SHIPPED") return true;
  if (fulfilment === "FULFILLED" || fulfilment === "PARTIALLY FULFILLED") return true;
  return snapshot.trackingNumbers.length > 0;
}

function dispatchDetail(snapshot: TrackerSnapshot) {
  const carrier = carrierName(snapshot.carrier);
  const tracking = snapshot.trackingNumbers.join(", ");
  if (carrier && tracking) return `${carrier} · ${tracking}`;
  return carrier ?? (tracking || null);
}

export function expectedDate(snapshot: TrackerSnapshot, install: TrackerInstall | null) {
  if (install && LIVE_INSTALL.has(install.status) && install.startOn) return trackerDay(install.startOn);
  return trackerDay(snapshot.shipBy) ?? trackerDay(snapshot.requiredBy);
}

export function trackerStages(snapshot: TrackerSnapshot, visiblePhotoCount: number, install: TrackerInstall | null): TrackerStage[] {
  const flags: Record<TrackerStageId, boolean> = {
    confirmed: isConfirmed(snapshot),
    preparing: isPreparing(snapshot),
    checked: visiblePhotoCount > 0,
    dispatched: isDispatched(snapshot),
    install_booked: Boolean(install && LIVE_INSTALL.has(install.status)),
    installed: install?.status === "completed",
  };
  if (flags.installed) flags.install_booked = true;
  if (flags.dispatched || flags.checked || flags.preparing || flags.install_booked) flags.confirmed = true;
  if (flags.dispatched || flags.checked) flags.preparing = true;
  if (flags.installed) flags.preparing = true;

  let current = -1;
  TRACKER_STAGE_IDS.forEach((id, index) => {
    if (flags[id]) current = index;
  });

  return TRACKER_STAGE_IDS.map((id, index) => {
    let state: TrackerStageState = "upcoming";
    if (current >= 0 && index < current) state = flags[id] ? "done" : "skipped";
    if (index === current) state = "current";
    let detail: string | null = null;
    if (id === "dispatched" && flags.dispatched && state !== "upcoming") detail = dispatchDetail(snapshot);
    if ((id === "install_booked" || id === "installed") && install?.startOn && state !== "upcoming" && state !== "skipped") {
      detail = trackerDay(install.startOn)?.label ?? null;
    }
    return { id, label: STAGE_LABELS[id], state, detail };
  });
}

export function quantityLabel(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0";
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 1000) / 1000);
}
