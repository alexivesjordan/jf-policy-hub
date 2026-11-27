import "server-only";

import { isFixtureMode } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { sampleCase, sampleCases, sampleHome, sampleMe, samplePerson, sampleSettings, sampleTeam } from "@/features/hr/sample";
import { checklistScope, type ChecklistView, type OpenChecklistCard } from "@/lib/hr/checklists";

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
  if (self.error || !self.data) return { ...sampleHome, name: "My HR", pending: [], waiting: [], manager: false, director: false, allowance: { entitlement: 0, taken: 0, booked: 0, left: 0 }, checklistScope: "none" as const, checklists: [] };
  const person = self.data;
  const [leave, changes, reports, scopeResult, openResult] = await Promise.all([
    db.from("leave_requests").select("id, employee_id, starts_on, ends_on, status, days"),
    db.from("change_requests").select("id, employee_id, field_key, status"),
    db.from("employees").select("id").eq("manager_id", person.id),
    supabase.rpc("hr_checklist_access", { p_employee: null }),
    supabase.rpc("hr_open_checklists"),
  ]);
  const openRows = Array.isArray(openResult.data) ? openResult.data : [];
  const checklists: OpenChecklistCard[] = openRows.map((row) => ({
    id: String(row.id),
    employeeId: String(row.employee_id),
    name: String(row.full_name ?? ""),
    kind: String(row.kind ?? ""),
    dueOn: row.due_on ? String(row.due_on) : "",
    openItems: Number(row.open_items ?? 0),
  }));
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
    checklistScope: checklistScope(scopeResult.error ? "none" : scopeResult.data),
    checklists,
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

function text(value: unknown) {
  return value == null ? "" : String(value);
}

function checklistViews(value: unknown): ChecklistView[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    const list = row as Record<string, unknown>;
    const items = Array.isArray(list.items) ? list.items : [];
    return {
      id: text(list.id),
      kind: text(list.kind),
      status: text(list.status),
      dueOn: text(list.due_on),
      items: items.map((item) => {
        const rowItem = item as Record<string, unknown>;
        return {
          id: text(rowItem.id),
          label: text(rowItem.label),
          owner: text(rowItem.owner),
          dueOn: text(rowItem.due_on),
          doneAt: rowItem.done_at ? text(rowItem.done_at) : null,
          linkKind: text(rowItem.link_kind),
        };
      }),
    };
  });
}

export async function loadPerson(id: string) {
  if (isFixtureMode()) return { ...samplePerson, id };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await hr();
  const supabase = await createClient();
  const [row, packResult] = await Promise.all([
    db.from("employees").select("id, full_name, job_title, department, location, work_email, phone, start_date, status, end_date, profile_id").eq("id", id).maybeSingle(),
    supabase.rpc("hr_person_checklists", { p_employee: id }),
  ]);
  const pack = packResult.data && typeof packResult.data === "object" ? packResult.data as Record<string, unknown> : {};
  const access = pack.access === "edit" || pack.access === "mfa" ? pack.access : "none";
  const employee = pack.employee && typeof pack.employee === "object" ? pack.employee as Record<string, unknown> : null;
  const header = row.data
    ? {
        id: String(row.data.id),
        name: String(row.data.full_name ?? ""),
        role: row.data.job_title ?? "",
        department: row.data.department ?? "",
        location: row.data.location ?? "",
        email: row.data.work_email ?? "",
        phone: row.data.phone ?? "",
        start: row.data.start_date ?? "",
        status: row.data.status ?? "active",
        end: row.data.end_date ?? "",
        profileId: row.data.profile_id ?? null,
      }
    : employee
      ? {
          id: text(employee.id),
          name: text(employee.full_name),
          role: text(employee.job_title),
          department: text(employee.department),
          location: text(employee.location),
          email: text(employee.work_email),
          phone: text(employee.phone),
          start: text(employee.start_date),
          status: text(employee.status) || "active",
          end: text(employee.end_date),
          profileId: employee.profile_id ? text(employee.profile_id) : null,
        }
      : null;
  if (!header) {
    if (pack.access === "mfa") return { blocked: "mfa" as const };
    return null;
  }
  if (row.data) await supabase.rpc("hr_log_view", { p_table: "employees", p_id: id });
  return {
    ...samplePerson,
    ...header,
    pay: [],
    rtw: [],
    sickness: [],
    changes: [],
    review: false,
    contract: employee ? text(employee.contract_type) : samplePerson.contract,
    hours: employee && employee.hours_per_week != null ? text(employee.hours_per_week) : samplePerson.hours,
    notice: employee ? text(employee.notice_period) : samplePerson.notice,
    engineerResourceId: employee?.engineer_resource_id ? text(employee.engineer_resource_id) : null,
    checklistAccess: access,
    checklists: checklistViews(pack.checklists),
  };
}

export async function loadManagerOptions() {
  if (isFixtureMode()) return sampleTeam.map((person) => ({ id: person.id, name: person.name }));
  const supabase = await createClient();
  const result = await supabase.rpc("hr_manager_options");
  return (Array.isArray(result.data) ? result.data : []).map((row) => ({
    id: String(row.id),
    name: String(row.full_name ?? ""),
  }));
}

export async function loadCanAddEngineer() {
  if (isFixtureMode()) return true;
  const supabase = await createClient();
  const result = await supabase.rpc("workspace_is_admin");
  return result.data === true;
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
