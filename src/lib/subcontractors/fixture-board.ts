import { randomUUID } from "crypto";
import { selectionGate, type SubcontractorRecord } from "@/lib/subcontractors/capability";
import { isWeekday } from "@/lib/subcontractors/draft";
import { SEEDED_SUBCONTRACTORS } from "@/lib/subcontractors/seed-data";

type Doc = { id: string; fileId: string; expiresOn: string; label: string | null; bucket: string; path: string };
type Row = Omit<SubcontractorRecord, "insurance"> & { insurance: Doc[] };
type Thread = {
  id: string;
  installId: string;
  subcontractorId: string;
  replyToken: string;
  subject: string;
  status: string;
  suggestedPrice: number | null;
  confirmedPrice: number | null;
  messages: { id: string; direction: string; from: string | null; to: string | null; subject: string | null; body: string | null; delivery: string | null; suggestedPrice: number | null; createdAt: string }[];
};

const rows: Row[] = SEEDED_SUBCONTRACTORS.map((row) => ({
  id: row.id,
  name: row.name,
  contactName: row.contactName,
  phone: row.phone,
  emails: row.email ? [row.email] : [],
  regions: [...row.regions],
  jobTypes: [...row.jobTypes],
  maxCrew: row.maxCrew,
  status: row.status,
  notes: row.notes,
  insurance: [],
}));
const threads: Thread[] = [];
const tokens = new Map<string, { purpose: string; entity_table: string; entity_id: string }>();
let quoting: Record<string, unknown> | null = null;

export function fixtureSubcontractorRpc(fn: string, args: Record<string, unknown> = {}) {
  if (fn === "subcontractor_list") return done(rows);
  if (fn === "subcontractor_save") return done(save(args));
  if (fn === "subcontractor_remove") return done(remove(String(args.p_id ?? "")));
  if (fn === "subcontractor_attach_insurance") return done(attach(args));
  if (fn === "subcontractor_drop_insurance") return done(dropDoc(String(args.p_id ?? "")));
  if (fn === "subcontractor_open") return done(openQuote(args));
  if (fn === "subcontractor_log_message") return done(logMessage(args));
  if (fn === "subcontractor_record_reply") return done(recordReply(args));
  if (fn === "subcontractor_confirm_price") return done(confirm(args));
  if (fn === "subcontractor_award") return done(award(args));
  if (fn === "install_subcontractor_board") return done(board(String(args.p_id ?? "")));
  if (fn === "install_job_preview") return done(jobPreview(String(args.p_token_hash ?? "")));
  if (fn === "install_save_visit_sheet" || fn === "orbit_register_file" || fn === "email_record") return done(randomUUID());
  if (fn === "orbit_store_token_link") {
    tokens.set(String(args.p_token_hash ?? ""), { purpose: String(args.p_purpose ?? ""), entity_table: String(args.p_entity_table ?? ""), entity_id: String(args.p_entity_id ?? "") });
    return done(randomUUID());
  }
  if (fn === "orbit_resolve_token") return done(tokens.get(String(args.p_token_hash ?? "")) ?? null);
  if (fn === "install_read" && quoting && quoting.id === String(args.p_id ?? "")) return done(quoting);
  return { handled: false as const, data: null };
}

function done<T>(data: T) {
  return { handled: true as const, data };
}

function save(args: Record<string, unknown>) {
  const input = (args.p_row ?? {}) as Record<string, unknown>;
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("app: Enter a name.");
  const id = args.p_id ? String(args.p_id) : randomUUID();
  const next: Row = {
    id,
    name,
    contactName: String(input.contactName ?? "") || null,
    phone: String(input.phone ?? "") || null,
    emails: Array.isArray(input.emails) ? input.emails.map((item) => String(item).trim().toLowerCase()).filter(Boolean) : [],
    regions: Array.isArray(input.regions) ? input.regions.map(String) : [],
    jobTypes: Array.isArray(input.jobTypes) ? input.jobTypes.map((item) => String(item).toLowerCase()) : [],
    maxCrew: input.maxCrew ? Number(input.maxCrew) : null,
    status: String(input.status ?? "active") as Row["status"],
    notes: String(input.notes ?? "") || null,
    insurance: rows.find((row) => row.id === id)?.insurance ?? [],
  };
  const index = rows.findIndex((row) => row.id === id);
  if (index >= 0) rows[index] = next;
  else rows.push(next);
  return id;
}

function remove(id: string) {
  if (threads.some((thread) => thread.subcontractorId === id)) throw new Error("app: This subcontractor has quote threads.");
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) throw new Error("app: That subcontractor was not found.");
  rows.splice(index, 1);
  return null;
}

function attach(args: Record<string, unknown>) {
  const row = rows.find((item) => item.id === String(args.p_subcontractor ?? ""));
  if (!row) throw new Error("app: That subcontractor was not found.");
  const doc: Doc = { id: randomUUID(), fileId: String(args.p_file ?? ""), expiresOn: String(args.p_expires ?? ""), label: String(args.p_label ?? "") || null, bucket: "insurance", path: `ops/${row.id}/insurance.pdf` };
  row.insurance.push(doc);
  return doc.id;
}

function dropDoc(id: string) {
  for (const row of rows) {
    const index = row.insurance.findIndex((doc) => doc.id === id);
    if (index >= 0) {
      row.insurance.splice(index, 1);
      return null;
    }
  }
  throw new Error("app: That document was not found.");
}

function openQuote(args: Record<string, unknown>) {
  const dates = Array.isArray(args.p_dates) ? args.p_dates.map(String) : [];
  if (dates.length === 0 || dates.some((day) => !isWeekday(day))) throw new Error("app: Suggested dates have to be weekdays.");
  const sends = Array.isArray(args.p_sends) ? args.p_sends as { subcontractorId: string; replyToken: string; subject?: string; to?: string }[] : [];
  const today = new Date().toISOString().slice(0, 10);
  if (!quoting) {
    quoting = {
      id: "22222222-2222-4222-8222-222222222201",
      orderNumber: "FIXTURE-Q-1001",
      customerName: "FIXTURE — Riverside Gym",
      siteAddress: "Example Road, Leeds LS1 4DY",
      status: "quoting",
      stage: "quoting",
      startOn: null,
      endOn: null,
      installPrice: null,
      goodsNet: 1000,
      contactEmail: "alex.example@example.com",
      bookingRepName: "Alex Ives",
      deliveredBy: "subcontractor",
      subcontractorName: null,
      lines: [{ qty: 2, description: "FID Bench" }],
      crew: 2,
      vans: { size: "small", count: 1 },
      resources: [],
      flags: [],
      hqBuild: { personHours: 8 },
      siteInstall: { days: 1 },
    };
  }
  const created = sends.map((send) => {
    const row = rows.find((item) => item.id === send.subcontractorId);
    if (!row || !selectionGate(row, today).ok) throw new Error("app: That subcontractor has no in-date insurance.");
    const thread: Thread = { id: randomUUID(), installId: String(quoting?.id), subcontractorId: row.id, replyToken: send.replyToken, subject: send.subject ?? "Install quote", status: "queued", suggestedPrice: null, confirmedPrice: null, messages: [] };
    threads.push(thread);
    return { id: thread.id, subcontractorId: row.id, replyToken: thread.replyToken, email: send.to ?? row.emails[0] ?? "" };
  });
  return { installId: quoting?.id, threads: created };
}

function logMessage(args: Record<string, unknown>) {
  const thread = threads.find((item) => item.id === String(args.p_thread ?? ""));
  if (!thread) throw new Error("app: That reply was not found.");
  thread.messages.push({ id: randomUUID(), direction: String(args.p_direction ?? "out"), from: String(args.p_from ?? ""), to: String(args.p_to ?? ""), subject: String(args.p_subject ?? ""), body: String(args.p_body ?? ""), delivery: String(args.p_delivery ?? "") || null, suggestedPrice: null, createdAt: new Date().toISOString() });
  if (args.p_direction === "out") thread.status = "sent";
  return thread.id;
}

function recordReply(args: Record<string, unknown>) {
  const thread = threads.find((item) => item.replyToken === String(args.p_token ?? ""));
  if (!thread) return { matched: false };
  const suggested = args.p_suggested == null ? null : Number(args.p_suggested);
  thread.messages.push({ id: randomUUID(), direction: "in", from: String(args.p_from ?? ""), to: String(args.p_to ?? ""), subject: String(args.p_subject ?? ""), body: String(args.p_body ?? ""), delivery: null, suggestedPrice: suggested, createdAt: new Date().toISOString() });
  thread.status = "replied";
  if (suggested != null) thread.suggestedPrice = suggested;
  return { matched: true, threadId: thread.id, installId: thread.installId };
}

function confirm(args: Record<string, unknown>) {
  const thread = threads.find((item) => item.id === String(args.p_thread ?? ""));
  if (!thread) throw new Error("app: That reply was not found.");
  thread.confirmedPrice = Number(args.p_price);
  return null;
}

function award(args: Record<string, unknown>) {
  const thread = threads.find((item) => item.installId === String(args.p_install ?? "") && item.subcontractorId === String(args.p_subcontractor ?? ""));
  if (!thread?.confirmedPrice) throw new Error("app: Confirm the subcontractor price first.");
  if (!isWeekday(String(args.p_start ?? ""))) throw new Error("app: Choose a weekday start date.");
  const row = rows.find((item) => item.id === thread.subcontractorId);
  if (quoting) quoting = { ...quoting, status: "booked", stage: "booked", startOn: String(args.p_start), endOn: String(args.p_start), installPrice: Number(args.p_customer_price), subcontractorId: thread.subcontractorId, subcontractorName: row?.name ?? null, subcontractorPrice: thread.confirmedPrice };
  for (const item of threads) if (item.installId === thread.installId) item.status = item.id === thread.id ? "chosen" : "declined";
  return quoting;
}

function board(installId: string) {
  return threads.filter((thread) => thread.installId === installId).map((thread) => ({
    id: thread.id,
    subcontractorId: thread.subcontractorId,
    name: rows.find((item) => item.id === thread.subcontractorId)?.name ?? "Subcontractor",
    emails: rows.find((item) => item.id === thread.subcontractorId)?.emails ?? [],
    status: thread.status,
    subject: thread.subject,
    suggestedPrice: thread.suggestedPrice,
    confirmedPrice: thread.confirmedPrice,
    messages: thread.messages,
  }));
}

function jobPreview(hash: string) {
  const token = tokens.get(hash);
  if (!token || token.purpose !== "subcontractor_job") return null;
  return { installId: token.entity_id, orderNumber: quoting?.orderNumber ?? "", customerName: quoting?.customerName ?? "", siteAddress: quoting?.siteAddress ?? null, startOn: quoting?.startOn ?? null, endOn: quoting?.endOn ?? null, lines: [{ qty: "2", description: "FID Bench" }] };
}
