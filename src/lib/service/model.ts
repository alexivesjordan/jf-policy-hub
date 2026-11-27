import { normaliseUkPostcode } from "@/lib/quotes/postcode";

export const VISIT_TYPES = [
  ["repair", "Repair"],
  ["swap", "Equipment swap"],
  ["service", "Service"],
  ["collection", "Collection"],
  ["other", "Other"],
] as const;

export const VISIT_STATUSES = [
  ["scheduled", "Scheduled"],
  ["en_route", "En route"],
  ["on_site", "On site"],
  ["done", "Done"],
  ["incomplete", "Couldn't complete"],
] as const;

export type VisitType = (typeof VISIT_TYPES)[number][0];
export type VisitStatus = (typeof VISIT_STATUSES)[number][0];

export type VisitLine = {
  kind: "work" | "swap_out" | "swap_back";
  sku: string;
  serial: string;
  fault: string;
  parts: string;
  description: string;
};

export type VisitAsset = {
  make: string;
  model: string;
  serial: string;
};

export type VisitDraft = {
  customerName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postcode: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  visitType: string;
  notes: string;
  cin7OrderNumber: string;
  hubspotTicket: string;
  visitOn: string;
  windowStart: string;
  windowEnd: string;
  durationMinutes: string;
  assigneeIds: string[];
  lines: VisitLine[];
  assets: VisitAsset[];
  latitude?: number | null;
  longitude?: number | null;
  maintenancePlanId?: string;
};

export function visitTypeLabel(value: string) {
  return VISIT_TYPES.find(([code]) => code === value)?.[1] ?? value;
}

export function visitStatusLabel(value: string) {
  return VISIT_STATUSES.find(([code]) => code === value)?.[1] ?? value;
}

export function formatAddress(parts: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  postcode?: string | null;
}) {
  return [parts.addressLine1, parts.addressLine2, parts.city, parts.postcode]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(", ");
}

export function telHref(phone: string | null | undefined) {
  const cleaned = (phone ?? "").replace(/[^\d+]/g, "");
  if (cleaned.length < 5) return null;
  return `tel:${cleaned}`;
}

export function mailHref(email: string | null | undefined) {
  const trimmed = email?.trim() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return `mailto:${trimmed}`;
}

export function conflictLabel(kind: string, label: string) {
  if (kind === "install") return `Install ${label}`;
  return label.replaceAll("_", " ");
}

function blank(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : "";
}

export function parseVisitDraft(draft: VisitDraft): { ok: true; payload: Record<string, unknown> } | { ok: false; message: string } {
  const customerName = blank(draft.customerName);
  const addressLine1 = blank(draft.addressLine1);
  const postcode = normaliseUkPostcode(blank(draft.postcode));
  const visitType = blank(draft.visitType);
  const visitOn = blank(draft.visitOn);
  const duration = Number(blank(draft.durationMinutes));
  const windowStart = blank(draft.windowStart);
  const windowEnd = blank(draft.windowEnd);
  const email = blank(draft.contactEmail);
  if (!customerName) return { ok: false, message: "Enter the customer." };
  if (!addressLine1) return { ok: false, message: "Enter the address." };
  if (postcode.length < 3) return { ok: false, message: "Enter the postcode." };
  if (!VISIT_TYPES.some(([code]) => code === visitType)) return { ok: false, message: "Choose a visit type." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitOn)) return { ok: false, message: "Choose a date." };
  if (!Number.isInteger(duration) || duration < 15 || duration > 480) {
    return { ok: false, message: "Enter a duration between 15 and 480 minutes." };
  }
  if ((windowStart === "") !== (windowEnd === "")) return { ok: false, message: "Enter both times, or leave the window blank." };
  if (windowStart && windowEnd && windowEnd <= windowStart) return { ok: false, message: "The window end must be after the start." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "Enter a contact email." };
  if ((blank(draft.contactPhone) || email) && !blank(draft.contactName)) return { ok: false, message: "Enter the contact name." };
  const maintenancePlanId = blank(draft.maintenancePlanId ?? "");
  if (maintenancePlanId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(maintenancePlanId)) {
    return { ok: false, message: "That plan was not found." };
  }
  const lines = draft.lines
    .map((line) => ({
      kind: line.kind,
      sku: blank(line.sku),
      serial: blank(line.serial),
      fault: blank(line.fault),
      parts: blank(line.parts),
      description: blank(line.description),
    }))
    .filter((line) => line.sku || line.serial || line.fault || line.parts || line.description);
  if (visitType !== "swap" && lines.some((line) => line.kind !== "work")) {
    return { ok: false, message: "Swap kit is only for an equipment swap." };
  }
  const assets = draft.assets
    .map((asset) => ({ make: blank(asset.make), model: blank(asset.model), serial: blank(asset.serial) }))
    .filter((asset) => asset.make || asset.model || asset.serial);
  return {
    ok: true,
    payload: {
      customerName,
      addressLine1,
      addressLine2: blank(draft.addressLine2),
      city: blank(draft.city),
      postcode,
      contactName: blank(draft.contactName),
      contactPhone: blank(draft.contactPhone),
      contactEmail: email,
      visitType,
      notes: blank(draft.notes),
      cin7OrderNumber: blank(draft.cin7OrderNumber),
      hubspotTicket: blank(draft.hubspotTicket),
      visitOn,
      windowStart,
      windowEnd,
      durationMinutes: duration,
      assigneeIds: draft.assigneeIds,
      lines,
      assets,
      latitude: draft.latitude ?? null,
      longitude: draft.longitude ?? null,
      ...(maintenancePlanId ? { maintenancePlanId } : {}),
    },
  };
}
