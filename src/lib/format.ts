const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return value;
  return `${Number(match[3])} ${month} ${match[1]}`;
}

export function formatTimestamp(value: string | null | undefined) {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value);
  if (!match) return formatDate(value);
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return value;
  return `${Number(match[3])} ${month} ${match[1]}, ${match[4]}:${match[5]} UTC`;
}

export function londonToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function plusDays(isoDate: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return isoDate;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days);
  const next = new Date(utc);
  const year = next.getUTCFullYear();
  const month = String(next.getUTCMonth() + 1).padStart(2, "0");
  const day = String(next.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function roleLabel(role: string) {
  if (role === "admin") return "Administrator";
  if (role === "approver") return "Approver";
  return "Staff";
}

export function statusLabel(status: string) {
  if (status === "active") return "Active";
  if (status === "archived") return "Archived";
  if (status === "auto-applied") return "Applied automatically";
  if (status === "pending") return "Waiting for review";
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Draft";
}

export function severityLabel(severity: string) {
  if (severity === "low") return "Low";
  if (severity === "high") return "High";
  return "Medium";
}

export function displayName(person: { full_name: string | null; email: string } | null) {
  if (!person) return "Unassigned";
  const name = person.full_name?.trim();
  return name || person.email;
}

export function actorName(person: { full_name: string | null; email: string } | null) {
  if (!person) return "System";
  return displayName(person);
}

export function greetingName(person: { full_name: string | null; email: string }) {
  const name = person.full_name?.trim();
  if (name) return name.split(/\s+/)[0] ?? name;
  return person.email.split("@")[0] ?? "there";
}

export function needsDocument(policy: {
  current_content: string;
  source_file_path: string | null;
}) {
  return policy.current_content.trim().length === 0 && !policy.source_file_path;
}
