import type { ReminderKind } from "@/features/radar/types";

export function londonDay(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export function calendarDaysUntil(today: string, day: string) {
  const start = Date.parse(`${today}T00:00:00Z`);
  const end = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 86_400_000);
}

export function deadlineDay(deadline: string | null) {
  if (!deadline) return null;
  const date = new Date(deadline);
  if (!Number.isFinite(date.valueOf())) return null;
  return londonDay(date);
}

export function dueReminders(input: {
  status: string;
  ownerId: string | null;
  deadline: string | null;
  expectedAwardDate: string | null;
  already: ReminderKind[];
  today: string;
}) {
  if (!input.ownerId || input.status === "dismissed") return [] as ReminderKind[];
  const sent = new Set(input.already);
  const due: ReminderKind[] = [];
  const deadline = deadlineDay(input.deadline);
  const days = deadline ? calendarDaysUntil(input.today, deadline) : null;
  if (days != null && days >= 3 && days <= 7 && !sent.has("deadline_7")) due.push("deadline_7");
  if (days != null && days >= 0 && days <= 2 && !sent.has("deadline_2")) due.push("deadline_2");
  const award = input.expectedAwardDate?.slice(0, 10) ?? null;
  if (award && /^\d{4}-\d{2}-\d{2}$/.test(award) && !sent.has("award")) {
    const untilAward = calendarDaysUntil(input.today, award);
    if (untilAward != null && untilAward <= 0 && untilAward >= -2) due.push("award");
  }
  return due;
}

export function reminderCopy(kind: ReminderKind, title: string, buyer: string, when: string) {
  if (kind === "deadline_7") {
    return { title: "Tender deadline in 7 days", body: `${title}. ${buyer}. Deadline ${when}.` };
  }
  if (kind === "deadline_2") {
    return { title: "Tender deadline in 2 days", body: `${title}. ${buyer}. Deadline ${when}.` };
  }
  return { title: "Expected award date", body: `${title}. ${buyer}. Award date ${when}.` };
}
