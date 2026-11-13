import "server-only";

import { messageFromError } from "@/lib/errors";
import { riskFromUnknown, type OrderLineView, type RiskAnswers } from "@/lib/installs/visit-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

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
  const data = await userRpc<{ role?: string; jobs?: unknown }>("install_field_home");
  const role = data?.role;
  return {
    role: role === "admin" || role === "ops" || role === "engineer" ? role : "none",
    jobs: asJobs(data?.jobs),
  };
}

export async function visitContext(installId: string) {
  return asVisitContext(await userRpc("install_visit_context", { p_install: installId }));
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
