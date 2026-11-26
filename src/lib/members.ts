export type MemberAccess = { pulse: string; level: string; source: string };

export type MemberRow = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  workspace_role: string;
  access_mode: "follow" | "custom";
  is_active: boolean;
  last_sign_in_at?: string | null;
  two_step?: boolean;
  teams: { id: string; name: string }[] | string[];
  access?: MemberAccess[];
  effective?: Record<string, string>;
};

const PULSE_LABELS: Record<string, string> = {
  people: "People",
  operations: "Operations",
  sales: "Sales",
  logistics: "Logistics",
};

export function memberName(person: { full_name?: string | null; first_name?: string | null; last_name?: string | null; email: string }) {
  const named = [person.first_name, person.last_name].filter(Boolean).join(" ").trim();
  return person.full_name || named || person.email;
}

export function teamNames(person: MemberRow) {
  return person.teams.map((team) => (typeof team === "string" ? team : team.name));
}

export function pulseSummary(access: MemberAccess[] | undefined) {
  return (access ?? [])
    .filter((row) => row.level && row.level !== "none")
    .map((row) => `${PULSE_LABELS[row.pulse] ?? row.pulse} ${row.level}`)
    .join(", ");
}

export function memberMatches(
  person: MemberRow,
  filters: { query: string; role: string; team: string; status: string },
) {
  const query = filters.query.trim().toLowerCase();
  if (query) {
    const haystack = `${memberName(person)} ${person.email}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (filters.role && person.workspace_role !== filters.role) return false;
  if (filters.team && !teamNames(person).includes(filters.team)) return false;
  if (filters.status === "active" && !person.is_active) return false;
  if (filters.status === "inactive" && person.is_active) return false;
  return true;
}
