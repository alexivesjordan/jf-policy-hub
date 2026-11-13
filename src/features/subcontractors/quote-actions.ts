"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canUseOperations, canUseSales, moduleAllows } from "@/lib/access";
import type { ActionState } from "@/lib/action-state";
import { getCurrentProfile, requireSalesUser } from "@/lib/auth";
import { deliverPulseEmail } from "@/lib/email/deliver";
import { messageFromError } from "@/lib/errors";
import { issueInstallAccess } from "@/lib/installs/issue-access";
import { draftHtml, isWeekday } from "@/lib/subcontractors/draft";
import { inboundDomain, newReplyToken, replyAddress } from "@/lib/subcontractors/inbound";
import { deliverableEmails, selectionGate } from "@/lib/subcontractors/capability";
import { createTokenLink } from "@/lib/pulse/tokens";
import { siteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { listSubcontractorRecords } from "@/features/subcontractors/queries";

const ID = /^[0-9a-f-]{36}$/i;

export async function sendSubcontractorQuote(_state: ActionState, formData: FormData): Promise<ActionState> {
  await requireSalesUser();
  const quoteId = String(formData.get("savedQuoteId") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const dates = String(formData.get("dates") ?? "").split(",").map((day) => day.trim()).filter(Boolean);
  const ids = formData.getAll("subcontractorId").map(String).filter((id) => ID.test(id));
  if (!ID.test(quoteId)) return { ok: false, message: "Load the quote again." };
  if (!subject || !body) return { ok: false, message: "Write the email before sending." };
  if (dates.length === 0 || dates.some((day) => !isWeekday(day))) return { ok: false, message: "Suggested dates have to be weekdays." };
  if (ids.length === 0) return { ok: false, message: "Choose a subcontractor." };

  const today = new Date().toISOString().slice(0, 10);
  const directory = await listSubcontractorRecords();
  const chosen = directory.filter((row) => ids.includes(row.id));
  const blocked = chosen.find((row) => !selectionGate(row, today).ok);
  if (blocked) return { ok: false, message: `${blocked.name}: ${selectionGate(blocked, today).reason ?? "Cannot be emailed."}` };
  if (chosen.length !== ids.length) return { ok: false, message: "Choose a subcontractor from the list." };

  const domain = inboundDomain(process.env);
  const sends = chosen.map((row) => ({
    subcontractorId: row.id,
    replyToken: newReplyToken(),
    subject,
    to: deliverableEmails(row.emails),
  }));
  if (sends.some((send) => send.to.length === 0)) return { ok: false, message: "Check email before sending." };
  const supabase = await createClient();
  const opened = await supabase.rpc("subcontractor_open", { p_quote_id: quoteId, p_dates: dates, p_sends: sends });
  if (opened.error || !opened.data) return { ok: false, message: messageFromError(opened.error, "Could not open that quote.") };
  const result = opened.data as { installId: string; threads: { id: string; replyToken: string; emails: string[] }[] };
  await mailThreads(supabase, result.installId, subject, body, domain, result.threads ?? []);
  revalidatePath("/sales/installs");
  revalidatePath("/operations/installs");
  redirect(`/sales/installs/${result.installId}`);
}

export async function resendFailedQuote(threadId: string): Promise<ActionState> {
  const profile = await requireQuoteEditor();
  if (!profile) return { ok: false, message: "You cannot send that quote." };
  if (!ID.test(threadId)) return { ok: false, message: "That thread was not found." };
  const supabase = await createClient();
  const prepared = await supabase.rpc("subcontractor_resend", { p_thread: threadId });
  if (prepared.error || !prepared.data) return { ok: false, message: messageFromError(prepared.error, "Could not resend that quote.") };
  const row = prepared.data as { installId: string; replyToken: string; subject: string; body: string; emails: string[] };
  await mailThreads(supabase, row.installId, row.subject, row.body, inboundDomain(process.env), [{
    id: threadId,
    replyToken: row.replyToken,
    emails: row.emails ?? [],
  }]);
  revalidatePath(`/sales/installs/${row.installId}`);
  revalidatePath(`/operations/installs/${row.installId}`);
  return { ok: true, message: "Quote resent." };
}

async function mailThreads(
  supabase: Awaited<ReturnType<typeof createClient>>,
  installId: string,
  subject: string,
  body: string,
  domain: string,
  threads: { id: string; replyToken: string; emails: string[] }[],
) {
  const html = draftHtml(body);
  for (const thread of threads) {
    for (const email of thread.emails) {
      const sent = await deliverPulseEmail({
        to: email,
        subject,
        template: "subcontractor_quote",
        text: body,
        html,
        installId,
        replyTo: replyAddress(thread.replyToken, domain),
      });
      await supabase.rpc("subcontractor_log_message", {
        p_thread: thread.id,
        p_direction: "out",
        p_from: "pulse@jordanfitness.com",
        p_to: email,
        p_subject: subject,
        p_body: body,
        p_provider: sent.providerId,
        p_delivery: sent.status,
        p_suggested: null,
      });
    }
  }
}

export async function confirmSubcontractorPrice(threadId: string, price: string): Promise<ActionState> {
  const profile = await requireQuoteEditor();
  if (!profile) return { ok: false, message: "You cannot confirm that price." };
  if (!ID.test(threadId)) return { ok: false, message: "That reply was not found." };
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: "Enter the subcontractor price." };
  const supabase = await createClient();
  const saved = await supabase.rpc("subcontractor_confirm_price", { p_thread: threadId, p_price: amount });
  if (saved.error) return { ok: false, message: messageFromError(saved.error, "Could not confirm that price.") };
  return { ok: true, message: "Subcontractor price confirmed." };
}

export async function awardSubcontractor(installId: string, subcontractorId: string, customerPrice: string, start: string): Promise<ActionState & { jobSheetUrl?: string }> {
  const profile = await requireQuoteEditor();
  if (!profile) return { ok: false, message: "You cannot award that quote." };
  if (!ID.test(installId) || !ID.test(subcontractorId)) return { ok: false, message: "That quote is not open." };
  if (!isWeekday(start)) return { ok: false, message: "Choose a weekday start date." };
  const amount = Number(customerPrice);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: "Enter the customer price." };
  const supabase = await createClient();
  const awarded = await supabase.rpc("subcontractor_award", {
    p_install: installId,
    p_subcontractor: subcontractorId,
    p_customer_price: amount,
    p_start: start,
  });
  if (awarded.error) return { ok: false, message: messageFromError(awarded.error, "Could not book that install.") };
  const install = (awarded.data ?? {}) as { contactEmail?: string | null; endOn?: string | null; orderNumber?: string; siteAddress?: string | null };
  let jobSheetUrl: string | undefined;
  try {
    jobSheetUrl = await sendJobSheetLink({
      installId,
      email: await subcontractorEmail(subcontractorId),
      orderNumber: String(install.orderNumber ?? ""),
      siteAddress: install.siteAddress ?? null,
      endOn: install.endOn ? String(install.endOn).slice(0, 10) : null,
    });
  } catch (error) {
    console.error("Job sheet link was not sent", error instanceof Error ? error.name : "error");
  }
  try {
    await issueInstallAccess({ id: installId, contactEmail: install.contactEmail, endOn: install.endOn ? String(install.endOn).slice(0, 10) : null });
  } catch (error) {
    console.error("Access link was not sent", error instanceof Error ? error.name : "error");
  }
  revalidatePath(`/sales/installs/${installId}`);
  revalidatePath(`/operations/installs/${installId}`);
  return { ok: true, message: jobSheetUrl ? "Booked. The job sheet link is ready." : "Booked. The job sheet email was not sent.", jobSheetUrl };
}

export async function resendJobSheet(installId: string): Promise<ActionState & { jobSheetUrl?: string }> {
  const profile = await requireQuoteEditor();
  if (!profile) return { ok: false, message: "You cannot send that link." };
  if (!ID.test(installId)) return { ok: false, message: "That install was not found." };
  const supabase = await createClient();
  const loaded = await supabase.rpc("install_read", { p_id: installId });
  if (loaded.error || !loaded.data) return { ok: false, message: messageFromError(loaded.error, "That install was not found.") };
  const install = loaded.data as { subcontractorId?: string | null; orderNumber?: string; siteAddress?: string | null; endOn?: string | null };
  if (!install.subcontractorId) return { ok: false, message: "Choose a subcontractor first." };
  try {
    const jobSheetUrl = await sendJobSheetLink({
      installId,
      email: await subcontractorEmail(install.subcontractorId),
      orderNumber: String(install.orderNumber ?? ""),
      siteAddress: install.siteAddress ?? null,
      endOn: install.endOn ? String(install.endOn).slice(0, 10) : null,
    });
    return { ok: true, message: "Job sheet link sent.", jobSheetUrl };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not send the job sheet link." };
  }
}

export async function readSubcontractorBoard(installId: string) {
  const profile = await getCurrentProfile();
  if (!profile || (!canUseSales(profile) && !canUseOperations(profile))) return [];
  if (!ID.test(installId)) return [];
  const supabase = await createClient();
  const loaded = await supabase.rpc("install_subcontractor_board", { p_id: installId });
  if (loaded.error || !Array.isArray(loaded.data)) return [];
  return loaded.data as {
    id: string;
    subcontractorId: string;
    name: string;
    emails: string[];
    status: string;
    subject: string;
    suggestedPrice: number | null;
    confirmedPrice: number | null;
    messages: { id: string; direction: string; from: string | null; to: string | null; subject: string | null; body: string | null; delivery: string | null; suggestedPrice: number | null; bodyUnavailable?: boolean; createdAt: string }[];
  }[];
}

export async function submitJobSheet(_state: ActionState, formData: FormData): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  const installId = String(formData.get("installId") ?? "");
  const engineerName = String(formData.get("engineerName") ?? "").trim();
  const work = String(formData.get("workCarriedOut") ?? "").trim();
  if (!engineerName) return { ok: false, message: "Add your name." };
  if (!ID.test(installId)) return { ok: false, message: "That link is not valid." };
  const { hashPulseToken } = await import("@/lib/pulse/token-hash");
  const hash = hashPulseToken(token);
  if (!hash) return { ok: false, message: "That link is not valid." };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "The job sheet is not available." };
  const saved = await admin.rpc("install_save_visit_sheet", {
    p_install: installId,
    p_sheet: { visitType: "install", engineerName, workCarriedOut: work, orderNo: String(formData.get("orderNo") ?? ""), address: String(formData.get("address") ?? "") },
    p_token_hash: hash,
  });
  if (saved.error) return { ok: false, message: messageFromError(saved.error, "Could not save that job sheet.") };
  return { ok: true, message: "Job sheet received." };
}

async function requireQuoteEditor() {
  const profile = await getCurrentProfile();
  if (!profile?.is_active || !profile.access_granted) return null;
  if (moduleAllows(profile, "sales", "edit") || moduleAllows(profile, "operations", "edit")) return profile;
  return null;
}

async function subcontractorEmail(id: string) {
  const rows = await listSubcontractorRecords();
  const email = rows.find((item) => item.id === id)?.emails.find((item) => item.trim()) ?? "";
  if (!email) throw new Error("That subcontractor has no email.");
  return email;
}

async function sendJobSheetLink(input: { installId: string; email: string; orderNumber: string; siteAddress: string | null; endOn: string | null }) {
  const link = await createTokenLink({
    purpose: "subcontractor_job",
    entitySchema: "ops",
    entityTable: "installs",
    entityId: input.installId,
    expiresAt: input.endOn ? `${input.endOn}T23:59:59.000Z` : null,
  });
  const url = `${siteUrl()}/job/${link.token}`;
  const text = [`Job sheet for order ${input.orderNumber}.`, input.siteAddress ? `Site: ${input.siteAddress}` : "", url].filter(Boolean).join("\n");
  await deliverPulseEmail({
    to: input.email,
    subject: `Job sheet ${input.orderNumber}`,
    template: "subcontractor_job",
    text,
    html: draftHtml(text),
    installId: input.installId,
  });
  return url;
}
