"use server";

import { canUseOperations, canUseSales } from "@/lib/access";
import { getCurrentProfile, requireOperationsUser, requireSalesUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { messageFromError } from "@/lib/errors";
import { dropWeekendStarts } from "@/lib/pulse/install-booking";
import { createClient } from "@/lib/supabase/server";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[0-9a-f-]{36}$/i;

export type InstallActionResult = {
  ok: boolean;
  message: string;
  dates?: string[];
  install?: Record<string, unknown> | null;
  installs?: Record<string, unknown>[];
};

async function requireInstallReader() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.access_granted) redirect("/no-access");
  if (!profile.is_active) redirect("/account-inactive");
  if (!canUseSales(profile) && !canUseOperations(profile)) redirect("/no-access");
  return profile;
}

function datesFrom(data: unknown) {
  if (!Array.isArray(data)) return [];
  return dropWeekendStarts(data.map((day) => String(day).slice(0, 10)).filter((day) => DAY.test(day)));
}

async function freshDates(quoteId: string, from: string, to: string) {
  const supabase = await createClient();
  const listed = await supabase.rpc("install_available_starts", { p_quote_id: quoteId, p_from: from, p_to: to });
  return datesFrom(listed.data);
}

export async function listInstallStartDates(quoteId: string, from: string, to: string): Promise<InstallActionResult> {
  await requireInstallReader();
  if (!ID.test(quoteId) || !DAY.test(from) || !DAY.test(to)) {
    return { ok: false, message: "Choose the quote and a date range.", dates: [] };
  }
  const supabase = await createClient();
  const listed = await supabase.rpc("install_available_starts", { p_quote_id: quoteId, p_from: from, p_to: to });
  if (listed.error) return { ok: false, message: messageFromError(listed.error, "Could not read available dates."), dates: [] };
  return { ok: true, message: "", dates: datesFrom(listed.data) };
}

export async function bookInstall(quoteId: string, startDate: string, warrantyOption = "none"): Promise<InstallActionResult> {
  await requireSalesUser();
  if (!ID.test(quoteId) || !DAY.test(startDate)) {
    return { ok: false, message: "Choose a start date.", dates: [] };
  }
  const supabase = await createClient();
  const booked = await supabase.rpc("install_book", {
    p_quote_id: quoteId,
    p_start: startDate,
    p_warranty: warrantyOption,
  });
  if (booked.error) {
    const message = messageFromError(booked.error, "Could not book that install.");
    const from = startDate;
    const to = new Date(new Date(`${startDate}T12:00:00Z`).getTime() + 21 * 86400000).toISOString().slice(0, 10);
    const dates = message.includes("no longer free") ? await freshDates(quoteId, from, to) : [];
    return { ok: false, message, dates };
  }
  return { ok: true, message: "Install booked.", install: (booked.data ?? null) as Record<string, unknown> | null };
}

export async function listInstalls(from: string, to: string, mine = false): Promise<InstallActionResult> {
  await requireInstallReader();
  if (!DAY.test(from) || !DAY.test(to)) return { ok: false, message: "Choose a date range.", installs: [] };
  const supabase = await createClient();
  const listed = await supabase.rpc("install_calendar", { p_from: from, p_to: to, p_mine: mine });
  if (listed.error) return { ok: false, message: messageFromError(listed.error, "Could not read installs."), installs: [] };
  return { ok: true, message: "", installs: Array.isArray(listed.data) ? (listed.data as Record<string, unknown>[]) : [] };
}

export async function readInstall(installId: string): Promise<InstallActionResult> {
  await requireInstallReader();
  if (!ID.test(installId)) return { ok: false, message: "That install was not found." };
  const supabase = await createClient();
  const loaded = await supabase.rpc("install_read", { p_id: installId });
  if (loaded.error) return { ok: false, message: messageFromError(loaded.error, "That install was not found.") };
  return { ok: true, message: "", install: (loaded.data ?? null) as Record<string, unknown> | null };
}

export async function moveInstall(installId: string, startDate: string): Promise<InstallActionResult> {
  await requireOperationsUser();
  if (!ID.test(installId) || !DAY.test(startDate)) return { ok: false, message: "Choose a start date.", dates: [] };
  const supabase = await createClient();
  const moved = await supabase.rpc("install_move", { p_id: installId, p_start: startDate });
  if (moved.error) {
    return { ok: false, message: messageFromError(moved.error, "Could not move that install."), dates: [] };
  }
  return { ok: true, message: "Install dates updated.", install: (moved.data ?? null) as Record<string, unknown> | null };
}

export async function installProposalUrl(path: unknown) {
  await requireInstallReader();
  if (typeof path !== "string" || !path) return null;
  if (path.startsWith("https://") || path.startsWith("http://")) return path;
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  if (!admin) return null;
  const signed = await admin.storage.from("service-proposals").createSignedUrl(path, 60 * 10);
  return signed.data?.signedUrl ?? null;
}

export async function setInstallStatus(installId: string, status: string): Promise<InstallActionResult> {
  await requireOperationsUser();
  if (!ID.test(installId)) return { ok: false, message: "That install was not found." };
  const supabase = await createClient();
  const updated = await supabase.rpc("install_set_status", { p_id: installId, p_status: status });
  if (updated.error) return { ok: false, message: messageFromError(updated.error, "Could not update that install.") };
  return { ok: true, message: "Install updated.", install: (updated.data ?? null) as Record<string, unknown> | null };
}
