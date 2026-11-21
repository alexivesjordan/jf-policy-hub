import "server-only";

import { messageFromError } from "@/lib/errors";
import { riskFromUnknown, type OrderLineView, type RiskAnswers } from "@/lib/installs/visit-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type BriefingPhoto = { id: string; itemKey: string; url: string | null; bucket?: string | null; path?: string | null };
export type BriefingItem = { key: string; name: string; qty: number; sku: string; photos: BriefingPhoto[] };
export type PrepTaskView = { id: string; kind: string; title: string; body: string | null; status: string; dueOn: string | null };
export type PersonOption = { id: string; name: string };
export type FleetVan = { id: string; registration: string; name: string | null };
export type AccessMedia = { id: string; url: string | null; mime: string | null; bucket?: string | null; path?: string | null };
export type VehicleCheckView = {
  submitted: boolean;
  fitToDrive: boolean;
  newDamage: boolean;
  damageNote: string | null;
  driverId: string;
  vanId: string;
};

export type JobBriefing = {
  started: boolean;
  canStart: boolean;
  accessAnswers: Record<string, unknown> | null;
  accessMedia: AccessMedia[];
  hqItems: BriefingItem[];
  hqHours: number | null;
  siteHours: number | null;
  siteDays: number | null;
  crew: number | null;
  tasks: PrepTaskView[];
  assignees: PersonOption[];
  vans: FleetVan[];
  defaultVanId: string | null;
  vehicleCheck: VehicleCheckView | null;
};

export type FieldJob = {
  id: string;
  orderNumber: string;
  customerName: string;
  siteAddress: string | null;
  startOn: string;
  endOn: string;
  status: string;
  today: boolean;
  assigneeNames: string[];
};

export type VisitContext = {
  role: "admin" | "ops" | "engineer" | "token" | "none";
  engineerName: string;
  submitted: boolean;
  risk: RiskAnswers | null;
  lines: OrderLineView[];
  briefing: JobBriefing;
  job: {
    id: string;
    orderNumber: string;
    customerName: string;
    siteAddress: string | null;
    contactName: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    startOn: string;
    endOn: string;
    status: string;
  };
};

type RpcError = { message?: string };

async function userRpc<T>(fn: string, args?: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(messageFromError(error as RpcError, "Could not load that job."));
  return data as T;
}

function asJobs(value: unknown): FieldJob[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as FieldJob;
    if (!row.id) return [];
    return [{
      id: row.id,
      orderNumber: row.orderNumber,
      customerName: row.customerName ?? "Customer",
      siteAddress: row.siteAddress ?? null,
      startOn: row.startOn,
      endOn: row.endOn,
      status: row.status,
      today: Boolean(row.today),
      assigneeNames: Array.isArray(row.assigneeNames) ? row.assigneeNames : [],
    }];
  });
}

function asLines(value: unknown): OrderLineView[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const qty = typeof row.qty === "number" ? row.qty : Number(row.qty);
    return {
      sku: String(row.sku ?? ""),
      description: String(row.description ?? ""),
      productLine: row.productLine == null ? null : String(row.productLine),
      category: row.category == null ? null : String(row.category),
      qty: Number.isFinite(qty) ? qty : null,
    };
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap((item) => { const row = asRecord(item); return row ? [row] : []; }) : [];
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asBriefing(row: Record<string, unknown>, alreadyStarted: boolean): JobBriefing {
  const access = asRecord(row.access);
  const hq = asRecord(row.hqBuild);
  const site = asRecord(row.siteInstall);
  const check = asRecord(row.vehicleCheck);
  const tasks = asList(row.prep).map((task) => ({
    id: String(task.id ?? ""),
    kind: String(task.kind ?? ""),
    title: String(task.title ?? "Task"),
    body: text(task.body),
    status: String(task.status ?? "open"),
    dueOn: text(task.dueOn)?.slice(0, 10) ?? null,
  })).filter((task) => task.id);
  const hqTask = asList(row.prep).find((task) => task.kind === "hq_build");
  const photos = asList(hqTask?.photos);
  const hqItems = asList(hqTask?.items).map((item) => {
    const key = String(item.key ?? "");
    return {
      key,
      name: String(item.name ?? "Item"),
      qty: numberOrNull(item.qty) ?? 1,
      sku: String(item.sku ?? ""),
      photos: photos.filter((photo) => photo.itemKey === key).map((photo) => ({
        id: String(photo.id ?? ""),
        itemKey: key,
        url: null,
        bucket: text(photo.bucket),
        path: text(photo.path),
      })),
    };
  }).filter((item) => item.key);
  return {
    started: row.started === true || alreadyStarted,
    canStart: row.canStart === true,
    accessAnswers: asRecord(access?.answers),
    accessMedia: asList(access?.media).flatMap((file) => {
      const id = String(file.id ?? "");
      if (!id) return [];
      return [{ id, url: null, mime: text(file.mime), bucket: text(file.bucket), path: text(file.path) }];
    }),
    hqItems,
    hqHours: numberOrNull(hq?.personHours),
    siteHours: numberOrNull(site?.onSiteHours),
    siteDays: numberOrNull(site?.days),
    crew: numberOrNull(row.crew),
    tasks,
    assignees: asList(row.assignees).flatMap((person) => {
      const id = String(person.id ?? "");
      if (!id) return [];
      return [{ id, name: String(person.name ?? "Engineer") }];
    }),
    vans: asList(row.vans).flatMap((van) => {
      const id = String(van.id ?? "");
      const registration = text(van.registration);
      if (!id || !registration) return [];
      return [{ id, registration, name: text(van.name) }];
    }),
    defaultVanId: text(row.defaultVanId),
    vehicleCheck: check ? {
      submitted: true,
      fitToDrive: check.fitToDrive === true,
      newDamage: check.newDamage === true,
      damageNote: text(check.damageNote),
      driverId: String(check.driverId ?? ""),
      vanId: String(check.vanId ?? ""),
    } : null,
  };
}

async function signPath(bucket: string | null | undefined, path: string | null | undefined) {
  if (!bucket || !path) return null;
  const admin = createAdminClient();
  if (!admin) return null;
  const signed = await admin.storage.from(bucket).createSignedUrl(path, 60 * 10);
  return signed.data?.signedUrl ?? null;
}

export function asVisitContext(value: unknown): VisitContext | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const job = row.job as VisitContext["job"] | undefined;
  if (!job?.id) return null;
  const risk = row.risk && typeof row.risk === "object" ? (row.risk as { answers?: unknown }).answers : null;
  const role = row.role;
  return {
    role: role === "admin" || role === "ops" || role === "engineer" || role === "token" ? role : "none",
    engineerName: String(row.engineerName ?? ""),
    submitted: Boolean(row.submitted),
    risk: riskFromUnknown(risk),
    lines: asLines(row.lines),
    briefing: asBriefing(row, riskFromUnknown(risk) != null || Boolean(row.submitted)),
    job: {
      id: job.id,
      orderNumber: job.orderNumber,
      customerName: job.customerName,
      siteAddress: job.siteAddress ?? null,
      contactName: job.contactName ?? null,
      contactPhone: job.contactPhone ?? null,
      contactEmail: job.contactEmail ?? null,
      startOn: job.startOn,
      endOn: job.endOn,
      status: job.status,
    },
  };
}

export async function fieldHome() {
  const data = await userRpc<{ role?: string; jobs?: unknown; needsLink?: boolean }>("install_field_home");
  const role = data?.role;
  return {
    role: role === "admin" || role === "ops" || role === "engineer" ? role : "none",
    jobs: asJobs(data?.jobs),
    needsLink: data?.needsLink === true,
  };
}

export async function listActiveVans() {
  try {
    const data = await userRpc<{ registration?: string; name?: string | null }[]>("install_list_vans");
    if (!Array.isArray(data)) return [];
    return data.flatMap((van) => (van?.registration ? [{ registration: van.registration, name: van.name ?? null }] : []));
  } catch {
    return [];
  }
}

export async function visitContext(installId: string) {
  const visit = asVisitContext(await userRpc("install_visit_context", { p_install: installId }));
  if (!visit) return null;
  visit.briefing.accessMedia = await Promise.all(visit.briefing.accessMedia.map(async (file) => ({
    id: file.id,
    mime: file.mime,
    url: await signPath(file.bucket, file.path),
  })));
  visit.briefing.hqItems = await Promise.all(visit.briefing.hqItems.map(async (item) => ({
    ...item,
    photos: await Promise.all(item.photos.map(async (photo) => ({
      id: photo.id,
      itemKey: photo.itemKey,
      url: await signPath(photo.bucket, photo.path),
    }))),
  })));
  return visit;
}

export async function mySignature() {
  const data = await userRpc<{ fileId?: string; bucket?: string; path?: string } | null>("install_my_signature");
  if (!data?.fileId || !data.bucket || !data.path) return null;
  const admin = createAdminClient();
  if (!admin) return { fileId: data.fileId, url: null };
  const signed = await admin.storage.from(data.bucket).createSignedUrl(data.path, 60 * 10);
  return { fileId: data.fileId, url: signed.data?.signedUrl ?? null };
}

export async function fieldRole() {
  const data = await userRpc<string>("install_field_role");
  return data === "admin" || data === "ops" || data === "engineer" ? data : "none";
}

export async function canManageVisitDocuments() {
  const role = await fieldRole();
  return role === "admin" || role === "ops";
}

export async function listVisitDocuments() {
  const data = await userRpc<{ key: "catalogue" | "elite_strength" | "performance_strength" | "cardio" }[]>("install_list_visit_documents");
  return Array.isArray(data) ? data : [];
}

export async function engineerLinks() {
  const data = await userRpc<{ name: string; linked: boolean; profileName: string | null }[]>("install_engineer_links");
  return Array.isArray(data) ? data : [];
}
