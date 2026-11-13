"use server";

import { canUseOperations, canUseSales } from "@/lib/access";
import { getCurrentProfile, requireOperationsUser, requireSalesUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { messageFromError } from "@/lib/errors";
import { canManageInstall } from "@/lib/installs/access-auth";
import { issueInstallAccess } from "@/lib/installs/issue-access";
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
  path?: string;
};

async function requireInstallReader() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.access_granted) redirect("/no-access");
  if (!profile.is_active) redirect("/account-inactive");
  if (!canUseSales(profile) && !canUseOperations(profile)) redirect("/no-access");
  return profile;
}

async function withSignedMedia(install: Record<string, unknown> | null) {
  if (!install || !install.access || typeof install.access !== "object") return install;
  const access = install.access as { media?: { bucket?: string; path?: string; url?: string | null }[] };
  if (!Array.isArray(access.media) || access.media.length === 0) return install;
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  if (!admin) return install;
  access.media = await Promise.all(
    access.media.map(async (item) => {
      if (!item.bucket || !item.path) return item;
      const signed = await admin.storage.from(item.bucket).createSignedUrl(item.path, 60 * 10);
      return { ...item, url: signed.data?.signedUrl ?? null };
    }),
  );
  return install;
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
  const install = (booked.data ?? null) as { id?: string; contactEmail?: string | null; endOn?: string | null } | null;
  let needsEmail = false;
  if (install?.id) {
    try {
      const access = await issueInstallAccess({ id: install.id, contactEmail: install.contactEmail, endOn: String(install.endOn ?? "").slice(0, 10) || null });
      needsEmail = !access.sent;
    } catch (error) {
      console.error("Access link was not sent", error);
      needsEmail = true;
    }
  }
  return {
    ok: true,
    message: needsEmail ? "Install booked. The access form was not emailed. Copy the link from the install." : "Install booked.",
    install: (booked.data ?? null) as Record<string, unknown> | null,
  };
}

export async function setInstallContactEmail(installId: string, email: string): Promise<InstallActionResult> {
  await requireSalesUser();
  if (!ID.test(installId)) return { ok: false, message: "That install was not found." };
  const supabase = await createClient();
  const saved = await supabase.rpc("install_set_contact_email", { p_install: installId, p_email: email });
  if (saved.error) return { ok: false, message: messageFromError(saved.error, "Could not save that email.") };
  const loaded = await supabase.rpc("install_read", { p_id: installId });
  const row = loaded.data as { endOn?: string; contactEmail?: string } | null;
  try {
    const access = await issueInstallAccess({ id: installId, contactEmail: email, endOn: String(row?.endOn ?? "").slice(0, 10) || null });
    if (!access.sent) return { ok: true, message: "Email saved. The access form was not emailed. Copy the link from the install.", path: access.path ?? undefined };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The email was saved, but the access form was not sent." };
  }
  return { ok: true, message: "Access form sent." };
}

async function managedInstall(installId: string) {
  const profile = await requireSalesUser();
  if (!ID.test(installId)) return { ok: false as const, message: "That install was not found." };
  const supabase = await createClient();
  const loaded = await supabase.rpc("install_read", { p_id: installId });
  if (loaded.error || !loaded.data) return { ok: false as const, message: messageFromError(loaded.error, "That install was not found.") };
  const row = loaded.data as { bookingRepId?: string | null; contactEmail?: string | null; endOn?: string };
  if (!canManageInstall(profile, row.bookingRepId)) {
    return { ok: false as const, message: "You cannot change that install." };
  }
  return { ok: true as const, row };
}

export async function resendInstallAccess(installId: string): Promise<InstallActionResult> {
  const managed = await managedInstall(installId);
  if (!managed.ok) return managed;
  if (!managed.row.contactEmail) return { ok: false, message: "Add the customer's email first." };
  try {
    const access = await issueInstallAccess({
      id: installId,
      contactEmail: managed.row.contactEmail,
      endOn: String(managed.row.endOn ?? "").slice(0, 10) || null,
    });
    if (!access.sent) {
      return { ok: true, message: "A new link was created, but the email was not sent. Copy it from the install.", path: access.path ?? undefined };
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not send a new access link." };
  }
  return { ok: true, message: "A new access link was sent. The previous link no longer works." };
}

export async function copyInstallAccessLink(installId: string): Promise<InstallActionResult> {
  const managed = await managedInstall(installId);
  if (!managed.ok) return managed;
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Supabase is not configured." };
  const existing = await admin.rpc("install_latest_access_path", { p_install: installId });
  const path = typeof existing.data === "string" ? existing.data : "";
  if (existing.error || !path) return { ok: false, message: "There is no access link to copy yet." };
  return { ok: true, message: "Current access link.", path };
}

export async function listInstalls(from: string, to: string, mine = false): Promise<InstallActionResult> {
  await requireInstallReader();
  if (!DAY.test(from) || !DAY.test(to)) return { ok: false, message: "Choose a date range.", installs: [] };
  const supabase = await createClient();
  const listed = await supabase.rpc("install_calendar", { p_from: from, p_to: to, p_mine: mine });
  if (listed.error) return { ok: false, message: messageFromError(listed.error, "Could not read installs."), installs: [] };
  const rows = Array.isArray(listed.data) ? (listed.data as Record<string, unknown>[]) : [];
  return { ok: true, message: "", installs: rows };
}

export async function readInstall(installId: string): Promise<InstallActionResult> {
  await requireInstallReader();
  if (!ID.test(installId)) return { ok: false, message: "That install was not found." };
  const supabase = await createClient();
  const loaded = await supabase.rpc("install_read", { p_id: installId });
  if (loaded.error) return { ok: false, message: messageFromError(loaded.error, "That install was not found.") };
  return { ok: true, message: "", install: await withSignedMedia((loaded.data ?? null) as Record<string, unknown> | null) };
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
