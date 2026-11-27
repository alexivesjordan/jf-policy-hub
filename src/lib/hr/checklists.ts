import { addDays } from "@/lib/hr/leave";
import { newEngineerProblem } from "@/lib/installs/new-engineer";

/** Days from the start date until the onboarding checklist itself is due. */
export const ONBOARDING_WINDOW_DAYS = 14;

/** The offboarding checklist is due on the leave date. */
export const OFFBOARDING_WINDOW_DAYS = 0;

export const CHECKLIST_OWNERS = ["manager", "hr", "it", "operations"] as const;
export const CHECKLIST_LINKS = ["pulse_invite", "teams", "engineer_record", "deactivate_login", "none"] as const;
export const CHECKLIST_LOCATIONS = ["office", "warehouse", "field"] as const;

export type ChecklistOwner = (typeof CHECKLIST_OWNERS)[number];
export type ChecklistLink = (typeof CHECKLIST_LINKS)[number];
export type ChecklistLocation = (typeof CHECKLIST_LOCATIONS)[number];
export type ChecklistKind = "onboarding" | "offboarding";
export type ChecklistScope = "all" | "reports" | "mfa" | "none";

export type TemplateItem = {
  label: string;
  owner: ChecklistOwner;
  offsetDays: number;
  linkKind: ChecklistLink;
  fieldOnly?: boolean;
};

/** Kept in step with the seed in 20261129200000_hr_joiners_leavers.sql. */
export const ONBOARDING_TEMPLATE: TemplateItem[] = [
  { label: "Contract issued", owner: "hr", offsetDays: 0, linkKind: "none" },
  { label: "Right to work checked", owner: "hr", offsetDays: 0, linkKind: "none" },
  { label: "Pulse login invited", owner: "hr", offsetDays: 1, linkKind: "pulse_invite" },
  { label: "Teams set", owner: "it", offsetDays: 1, linkKind: "teams" },
  { label: "Line manager set", owner: "manager", offsetDays: 0, linkKind: "none" },
  { label: "H&S induction", owner: "operations", offsetDays: 5, linkKind: "none" },
  { label: "Kit issued", owner: "operations", offsetDays: 5, linkKind: "none" },
  { label: "Engineer record", owner: "operations", offsetDays: 1, linkKind: "engineer_record", fieldOnly: true },
];

export const OFFBOARDING_TEMPLATE: TemplateItem[] = [
  { label: "Leave date confirmed", owner: "manager", offsetDays: 0, linkKind: "none" },
  { label: "Holiday balance settled", owner: "hr", offsetDays: -5, linkKind: "none" },
  { label: "Kit returned", owner: "operations", offsetDays: 0, linkKind: "none" },
  { label: "Pulse login deactivated", owner: "it", offsetDays: 0, linkKind: "deactivate_login" },
  { label: "Engineer record inactive", owner: "operations", offsetDays: 0, linkKind: "engineer_record", fieldOnly: true },
  { label: "Exit chat", owner: "manager", offsetDays: -1, linkKind: "none" },
];

export type ExpandedItem = TemplateItem & { dueOn: string; position: number };

export type ChecklistItemView = {
  id: string;
  label: string;
  owner: string;
  dueOn: string;
  doneAt: string | null;
  linkKind: string;
};

export type ChecklistView = {
  id: string;
  kind: string;
  status: string;
  dueOn: string;
  items: ChecklistItemView[];
};

export type OpenChecklistCard = {
  id: string;
  employeeId: string;
  name: string;
  kind: string;
  dueOn: string;
  openItems: number;
};

function weekday(iso: string) {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Calendar date in Europe/London. */
export function londonToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Add calendar days, then land on a weekday.
 * Zero or positive offsets roll Saturday and Sunday forward.
 * Negative offsets roll them back, so a task due before the leave date stays before it.
 */
export function shiftDue(anchor: string, offsetDays: number) {
  const raw = addDays(anchor, offsetDays);
  const day = weekday(raw);
  if (day === 6) return addDays(raw, offsetDays < 0 ? -1 : 2);
  if (day === 0) return addDays(raw, offsetDays < 0 ? -2 : 1);
  return raw;
}

export function checklistDueOn(kind: ChecklistKind, anchor: string) {
  return shiftDue(anchor, kind === "onboarding" ? ONBOARDING_WINDOW_DAYS : OFFBOARDING_WINDOW_DAYS);
}

export function expandTemplate(items: TemplateItem[], input: { anchor: string; location: string }) {
  const expanded: ExpandedItem[] = [];
  for (const item of items) {
    if (item.fieldOnly && input.location !== "field") continue;
    expanded.push({
      ...item,
      dueOn: shiftDue(input.anchor, item.offsetDays),
      position: expanded.length,
    });
  }
  return expanded;
}

export function joinerEngineerProblem(
  input: { installEngineer: boolean; location: string; name: string; role: string },
  activeNames: string[],
) {
  if (!input.installEngineer) return null;
  if (input.location !== "field") return "Install engineers are field staff.";
  return newEngineerProblem({ name: input.name, role: input.role }, activeNames);
}

export function joinerProblem(
  input: {
    fullName: string;
    location: string;
    startDate: string;
    workEmail: string;
    hours: string;
    installEngineer: boolean;
    engineerRole: string;
  },
  activeNames: string[],
) {
  const name = input.fullName.trim().replace(/\s+/g, " ");
  if (!name || name.length > 160) return "Enter the person's name.";
  if (!CHECKLIST_LOCATIONS.includes(input.location as ChecklistLocation)) return "Choose a location.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) return "Check the start date.";
  if (input.workEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.workEmail)) return "Check the work email.";
  if (input.hours) {
    const hours = Number(input.hours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 80) return "Check the hours.";
  }
  return joinerEngineerProblem(
    { installEngineer: input.installEngineer, location: input.location, name, role: input.engineerRole },
    activeNames,
  );
}

export function samePersonName(left: string, right: string) {
  return left.trim().replace(/\s+/g, " ").toLowerCase() === right.trim().replace(/\s+/g, " ").toLowerCase();
}

export function checklistItemHref(
  linkKind: string,
  person: { profileId?: string | null; engineerResourceId?: string | null },
) {
  if (linkKind === "pulse_invite") return { href: "/settings/workspace/members", label: "Invite" };
  if (linkKind === "teams") return { href: "/settings/workspace/teams", label: "Teams" };
  if (linkKind === "deactivate_login") {
    return {
      href: person.profileId ? `/settings/workspace/members/${person.profileId}` : "/settings/workspace/members",
      label: "Member",
    };
  }
  if (linkKind === "engineer_record" && person.engineerResourceId) {
    return { href: "/operations/schedule", label: "Schedule" };
  }
  return null;
}

export function formatLondonDate(iso: string | null | undefined) {
  if (!iso) return "";
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function formatLondonWhen(iso: string | null | undefined) {
  if (!iso) return "";
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

export function ownerLabel(owner: string) {
  if (owner === "hr") return "HR";
  if (owner === "it") return "IT";
  return owner ? owner.charAt(0).toUpperCase() + owner.slice(1) : "";
}

export function kindLabel(kind: string) {
  if (kind === "offboarding") return "Offboarding";
  if (kind === "onboarding") return "Onboarding";
  return kind;
}

export function checklistScope(value: unknown): ChecklistScope {
  if (value === "all" || value === "reports" || value === "mfa" || value === "none") return value;
  return "none";
}
