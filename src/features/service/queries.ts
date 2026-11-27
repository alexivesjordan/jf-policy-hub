import "server-only";

import { messageFromError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ServicePerson = { id: string; name: string };
export type ServiceConflict = { resourceId: string; day: string; kind: string; label: string; href: string | null };
export type ServiceStop = {
  id: string;
  resourceId: string | null;
  day: string;
  stopOrder: number;
  customerName: string;
  postcode: string;
  city: string | null;
  visitType: string;
  status: string;
  durationMinutes: number;
  windowStart: string | null;
  windowEnd: string | null;
  assigneeCount: number;
};
export type ServiceBoard = {
  from: string;
  to: string;
  canEdit: boolean;
  people: ServicePerson[];
  conflicts: ServiceConflict[];
  stops: ServiceStop[];
  error: string | null;
};

export type ServiceLine = {
  id?: string;
  kind: "work" | "swap_out" | "swap_back";
  sku: string;
  serial: string;
  fault: string;
  parts: string;
  description: string;
};
export type ServiceAsset = { id?: string; make: string; model: string; serial: string };
export type ServicePhoto = { id: string; url: string | null };
export type ServiceVisit = {
  id: string;
  siteId: string;
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
  durationMinutes: number;
  status: string;
  incompleteReason: string;
  completionNote: string;
  assignees: { id: string; name: string; stopOrder: number }[];
  lines: ServiceLine[];
  assets: ServiceAsset[];
  photos: ServicePhoto[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

async function signPath(bucket: string, path: string) {
  const admin = createAdminClient();
  if (!admin) return null;
  const signed = await admin.storage.from(bucket).createSignedUrl(path, 60 * 10);
  return signed.data?.signedUrl ?? null;
}

export function asVisit(value: unknown): ServiceVisit | null {
  const row = record(value);
  if (!row?.id) return null;
  const lines = Array.isArray(row.lines) ? row.lines : [];
  const assets = Array.isArray(row.assets) ? row.assets : [];
  const assignees = Array.isArray(row.assignees) ? row.assignees : [];
  const photos = Array.isArray(row.photos) ? row.photos : [];
  return {
    id: String(row.id),
    siteId: text(row.siteId),
    customerName: text(row.customerName),
    addressLine1: text(row.addressLine1),
    addressLine2: text(row.addressLine2),
    city: text(row.city),
    postcode: text(row.postcode),
    contactName: text(row.contactName),
    contactPhone: text(row.contactPhone),
    contactEmail: text(row.contactEmail),
    visitType: text(row.visitType) || "repair",
    notes: text(row.notes),
    cin7OrderNumber: text(row.cin7OrderNumber),
    hubspotTicket: text(row.hubspotTicket),
    visitOn: text(row.visitOn).slice(0, 10),
    windowStart: text(row.windowStart),
    windowEnd: text(row.windowEnd),
    durationMinutes: Number(row.durationMinutes) || 60,
    status: text(row.status) || "scheduled",
    incompleteReason: text(row.incompleteReason),
    completionNote: text(row.completionNote),
    assignees: assignees.flatMap((item) => {
      const person = record(item);
      if (!person?.id) return [];
      return [{ id: String(person.id), name: text(person.name) || "Engineer", stopOrder: Number(person.stopOrder) || 0 }];
    }),
    lines: lines.flatMap((item) => {
      const line = record(item);
      if (!line) return [];
      const kind = line.kind === "swap_out" || line.kind === "swap_back" ? line.kind : "work";
      return [{
        id: text(line.id) || undefined,
        kind,
        sku: text(line.sku),
        serial: text(line.serial),
        fault: text(line.fault),
        parts: text(line.parts),
        description: text(line.description),
      }];
    }),
    assets: assets.flatMap((item) => {
      const asset = record(item);
      if (!asset) return [];
      return [{ id: text(asset.id) || undefined, make: text(asset.make), model: text(asset.model), serial: text(asset.serial) }];
    }),
    photos: photos.flatMap((item) => {
      const photo = record(item);
      if (!photo?.id) return [];
      return [{ id: String(photo.id), url: null, bucket: text(photo.bucket), path: text(photo.path) } as ServicePhoto & { bucket: string; path: string }];
    }),
  };
}

async function withPhotoUrls(visit: ServiceVisit, raw: unknown) {
  const row = record(raw);
  const photos = Array.isArray(row?.photos) ? row.photos : [];
  visit.photos = await Promise.all(photos.flatMap((item) => {
    const photo = record(item);
    if (!photo?.id) return [];
    return [signPath(text(photo.bucket), text(photo.path)).then((url) => ({ id: String(photo.id), url }))];
  }));
  return visit;
}

export async function loadServiceBoard(from: string, to: string): Promise<ServiceBoard> {
  const empty: ServiceBoard = { from, to, canEdit: false, people: [], conflicts: [], stops: [], error: null };
  const supabase = await createClient();
  const loaded = await supabase.rpc("service_board", { p_from: from, p_to: to });
  if (loaded.error || !loaded.data || typeof loaded.data !== "object") {
    return { ...empty, error: messageFromError(loaded.error, "Service visits are not available yet.") };
  }
  const data = loaded.data as Record<string, unknown>;
  return {
    from: text(data.from).slice(0, 10) || from,
    to: text(data.to).slice(0, 10) || to,
    canEdit: data.canEdit === true,
    people: Array.isArray(data.people)
      ? data.people.flatMap((item) => {
          const row = record(item);
          if (!row?.id) return [];
          return [{ id: String(row.id), name: text(row.name) || "Engineer" }];
        })
      : [],
    conflicts: Array.isArray(data.conflicts)
      ? data.conflicts.flatMap((item) => {
          const row = record(item);
          if (!row?.resourceId || !row.day) return [];
          return [{
            resourceId: String(row.resourceId),
            day: text(row.day).slice(0, 10),
            kind: text(row.kind),
            label: text(row.label),
            href: row.href ? String(row.href) : null,
          }];
        })
      : [],
    stops: Array.isArray(data.stops)
      ? data.stops.flatMap((item) => {
          const row = record(item);
          if (!row?.id) return [];
          return [{
            id: String(row.id),
            resourceId: row.resourceId ? String(row.resourceId) : null,
            day: text(row.day).slice(0, 10),
            stopOrder: Number(row.stopOrder) || 0,
            customerName: text(row.customerName) || "Customer",
            postcode: text(row.postcode),
            city: text(row.city) || null,
            visitType: text(row.visitType),
            status: text(row.status),
            durationMinutes: Number(row.durationMinutes) || 0,
            windowStart: text(row.windowStart) || null,
            windowEnd: text(row.windowEnd) || null,
            assigneeCount: Number(row.assigneeCount) || 0,
          }];
        })
      : [],
    error: null,
  };
}

export async function loadServicePeople() {
  const supabase = await createClient();
  const loaded = await supabase.rpc("service_people");
  if (loaded.error || !Array.isArray(loaded.data)) return [] as ServicePerson[];
  return loaded.data.flatMap((item) => {
    const row = record(item);
    if (!row?.id) return [];
    return [{ id: String(row.id), name: text(row.name) || "Engineer" }];
  });
}

export async function loadServiceVisit(id: string) {
  const supabase = await createClient();
  const loaded = await supabase.rpc("service_visit_open", { p_visit: id });
  if (loaded.error || !loaded.data) {
    return { visit: null as ServiceVisit | null, error: messageFromError(loaded.error, "That visit was not found.") };
  }
  const visit = asVisit(loaded.data);
  if (!visit) return { visit: null, error: "That visit was not found." };
  return { visit: await withPhotoUrls(visit, loaded.data), error: null as string | null };
}

export async function loadMyServiceDay() {
  const supabase = await createClient();
  const loaded = await supabase.rpc("service_visit_day");
  if (loaded.error || !loaded.data || typeof loaded.data !== "object") {
    return { day: "", stops: [] as ServiceVisit[], error: messageFromError(loaded.error, "Could not load your day.") };
  }
  const data = loaded.data as Record<string, unknown>;
  const rawStops = Array.isArray(data.stops) ? data.stops : [];
  const stops = await Promise.all(rawStops.flatMap((item) => {
    const visit = asVisit(item);
    return visit ? [withPhotoUrls(visit, item)] : [];
  }));
  return { day: text(data.day).slice(0, 10), stops, error: null as string | null };
}

export async function loadServiceSheet(visitId: string) {
  const supabase = await createClient();
  const loaded = await supabase.rpc("service_visit_sheet", { p_visit: visitId });
  if (loaded.error || !loaded.data || typeof loaded.data !== "object") return null;
  const row = loaded.data as Record<string, unknown>;
  if (row.submitted !== true) return { submitted: false, pdfUrl: null as string | null };
  const pdfUrl = await signPath(text(row.pdfBucket), text(row.pdfPath));
  return { submitted: true, pdfUrl };
}
