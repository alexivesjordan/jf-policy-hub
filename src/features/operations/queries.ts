import "server-only";

import { messageFromError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type {
  GateOverrideRow,
  JobDetail,
  JobSummary,
  OfficeContext,
  OrbitNotification,
  OrbitTask,
  PricingSettings,
  TermsVersion,
} from "@/features/operations/types";

async function rpc<T>(fn: string, args?: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(messageFromError(error, "Could not load Operations."));
  return data as T;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function getOfficeContext() {
  return rpc<OfficeContext>("orbit_office_context");
}

export async function listJobs() {
  return asArray<JobSummary>(await rpc("orbit_list_jobs"));
}

export async function getJob(id: string) {
  const row = await rpc<JobDetail | null>("orbit_get_job", { p_job_id: id });
  return row;
}

export async function readOwnerSettings() {
  const data = await rpc<{
    settings: unknown;
    pricing_settings: PricingSettings | null;
  }>("orbit_read_settings");
  return data.pricing_settings;
}

export async function readTerms() {
  return rpc<TermsVersion | null>("orbit_read_terms");
}

export async function listGateOverrides() {
  return asArray<GateOverrideRow>(await rpc("orbit_list_gate_overrides"));
}

export async function listOrbitNotifications(unreadOnly = false) {
  return asArray<OrbitNotification>(
    await rpc("orbit_list_notifications", { p_unread_only: unreadOnly }),
  );
}

export async function listOrbitTasks() {
  return asArray<OrbitTask>(await rpc("orbit_list_tasks"));
}
