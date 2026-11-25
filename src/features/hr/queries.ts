import "server-only";

import { isFixtureMode } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { sampleCase, sampleCases, sampleHome, sampleMe, samplePerson, sampleSettings, sampleTeam } from "@/features/hr/sample";

async function hr() {
  const supabase = await createClient();
  return {
    from(table: string) {
      return supabase.from(`hr_${table}`);
    },
  };
}

export async function loadHrHome() {
  if (isFixtureMode()) return sampleHome;
  const supabase = await createClient();
  const db = await hr();
  const mine = await supabase.rpc("hr_ensure_self");
  const selfId = typeof mine.data === "string" ? mine.data : "";
  const self = selfId
    ? await db.from("employees").select("id, preferred_name, full_name, manager_id").eq("id", selfId).maybeSingle()
    : { data: null, error: mine.error };
  if (self.error || !self.data) return { ...sampleHome, name: "My HR", pending: [], waiting: [], manager: false, director: false, allowance: { entitlement: 0, taken: 0, booked: 0, left: 0 } };
  const person = self.data;
  const [leave, changes, reports] = await Promise.all([
    db.from("leave_requests").select("id, employee_id, starts_on, ends_on, status, days"),
    db.from("change_requests").select("id, employee_id, field_key, status"),
    db.from("employees").select("id").eq("manager_id", person.id),
  ]);
  const rows = Array.isArray(leave.data) ? leave.data : [];
  const mineRows = rows.filter((row) => row.employee_id === person.id);
  const taken = mineRows.filter((row) => row.status === "approved").reduce((sum, row) => sum + Number(row.days ?? 0), 0);
  const booked = mineRows.filter((row) => row.status === "requested").reduce((sum, row) => sum + Number(row.days ?? 0), 0);
  const waiting = [
    ...rows.filter((row) => row.employee_id !== person.id && row.status === "requested").map((row) => ({
      id: String(row.id),
      kind: "leave" as const,
      label: `${row.starts_on} – ${row.ends_on}`,
      href: "/people/time-off",
    })),
    ...(Array.isArray(changes.data) ? changes.data : []).filter((row) => row.employee_id !== person.id && row.status === "pending").map((row) => ({
      id: String(row.id),
      kind: "change" as const,
      label: String(row.field_key),
      href: `/people/team/${row.employee_id}`,
    })),
  ];
  return {
    name: person.preferred_name || person.full_name,
    allowance: { entitlement: 20, taken, booked, left: Math.max(0, 20 - taken - booked) },
    pending: mineRows.filter((row) => row.status === "requested").map((row) => ({
      id: String(row.id),
      label: `${row.starts_on} – ${row.ends_on}`,
      status: "Requested",
      href: "/people/time-off",
    })),
    waiting,
    manager: (reports.data ?? []).length > 0,
    director: false,
    mfaRequired: false,
  };
}

export async function loadMyRecord() {
  if (isFixtureMode()) return sampleMe;
  const db = await hr();
  const self = await db.from("employees").select("preferred_name, full_name, job_title, department, location, work_email, phone, personal_email, home_address, start_date").limit(1).maybeSingle();
  if (!self.data) return { ...sampleMe, documents: [], changes: [], leave: [] };
  return {
    ...sampleMe,
    preferredName: self.data.preferred_name ?? self.data.full_name,
    fullName: self.data.full_name,
    jobTitle: self.data.job_title ?? "",
    department: self.data.department ?? "",
    location: self.data.location ?? "",
    workEmail: self.data.work_email ?? "",
    phone: self.data.phone ?? "",
    personalEmail: self.data.personal_email ?? "",
    address: typeof self.data.home_address === "string" ? self.data.home_address : "",
    startDate: self.data.start_date ?? "",
    documents: [],
    changes: [],
    leave: [],
  };
}

export async function loadTeam() {
  if (isFixtureMode()) return sampleTeam;
  const db = await hr();
  const rows = await db.from("employees").select("id, full_name, preferred_name, job_title, status").eq("status", "active").limit(50);
  return (rows.data ?? []).map((row) => ({
    id: String(row.id),
    name: row.preferred_name || row.full_name,
    role: row.job_title ?? "",
    status: "In",
    initials: String(row.full_name ?? "?").slice(0, 2).toUpperCase(),
  }));
}

export async function loadPerson(id: string) {
  if (isFixtureMode()) return { ...samplePerson, id };
  const db = await hr();
  const row = await db.from("employees").select("id, full_name, job_title, department, location, work_email, phone, start_date").eq("id", id).maybeSingle();
  if (!row.data) return null;
  await (await createClient()).rpc("hr_log_view", { p_table: "employees", p_id: id });
  return {
    ...samplePerson,
    id: row.data.id,
    name: row.data.full_name,
    role: row.data.job_title ?? "",
    department: row.data.department ?? "",
    location: row.data.location ?? "",
    email: row.data.work_email ?? "",
    phone: row.data.phone ?? "",
    start: row.data.start_date ?? "",
    pay: [],
    rtw: [],
    sickness: [],
    changes: [],
  };
}

export async function loadCases() {
  if (isFixtureMode()) return sampleCases;
  const db = await hr();
  const rows = await db.from("cases").select("id, title, stage, decision_due_on").limit(50);
  return (rows.data ?? []).map((row) => ({
    id: String(row.id),
    title: String(row.title),
    stage: String(row.stage),
    due: row.decision_due_on ? String(row.decision_due_on) : "",
  }));
}

export async function loadCase(id: string) {
  if (isFixtureMode()) return { ...sampleCase, id };
  const db = await hr();
  const row = await db.from("cases").select("id, title, stage, decision_due_on, case_type").eq("id", id).maybeSingle();
  if (!row.data) return null;
  await (await createClient()).rpc("hr_log_view", { p_table: "cases", p_id: id });
  const flexible = row.data.case_type === "flexible_working";
  return {
    ...sampleCase,
    id: row.data.id,
    title: row.data.title,
    stage: row.data.stage,
    due: row.data.decision_due_on ?? "",
    stages: flexible ? ["Requested", "Meeting", "Decided", "Appeal", "Closed"] : ["Raised", "Investigation", "Meeting invited", "Meeting held", "Outcome sent", "Appeal", "Closed"],
    entries: [],
    members: [],
  };
}

export async function loadHrSettings() {
  if (isFixtureMode()) return sampleSettings;
  const db = await hr();
  const row = await db.from("settings").select("leave_year_start_day, leave_year_start_month, bank_holiday_rule, default_allowance_days, carry_over_cap_days, inbound_email_enabled").limit(1).maybeSingle();
  if (!row.data) return sampleSettings;
  return {
    ...sampleSettings,
    leaveYear: `${row.data.leave_year_start_day} / ${row.data.leave_year_start_month}`,
    bankHolidayRule: row.data.bank_holiday_rule === "inside" ? "inside" as const : "on_top" as const,
    allowance: Number(row.data.default_allowance_days),
    carryOver: Number(row.data.carry_over_cap_days),
    inbound: Boolean(row.data.inbound_email_enabled),
    directors: [],
    partners: [],
  };
}
