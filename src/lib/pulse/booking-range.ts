import { planDay, type PoolResource } from "@/lib/pulse/availability";
import type { JobRequirements } from "@/lib/pulse/requirements";

export function addIsoDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isWeekend(iso: string) {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** N install days from a start date. Weekends are skipped unless the owner allows them. */
export function workingDaysFrom(start: string, count: number, allowWeekends: boolean) {
  const days: string[] = [];
  const total = Math.max(1, Math.floor(count));
  let cursor = start;
  let guard = 0;
  while (days.length < total && guard < 400) {
    if (allowWeekends || !isWeekend(cursor)) days.push(cursor);
    cursor = addIsoDays(cursor, 1);
    guard += 1;
  }
  return days;
}

export function weekendBookingError(dates: string[], canBookWeekends: boolean) {
  if (canBookWeekends || !dates.some(isWeekend)) return null;
  return "Weekend installs can only be pencilled by the owner.";
}

export function formatPencilDay(iso: string, withMonth: boolean) {
  const date = new Date(`${iso}T12:00:00Z`);
  const weekday = date.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const day = date.getUTCDate();
  if (!withMonth) return `${weekday} ${day}`;
  const month = date.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  return `${weekday} ${day} ${month}`;
}

export function pencilConfirmLabel(dates: string[], allowWeekends: boolean) {
  if (dates.length === 0) return "Pencil a day";
  const sameMonth = dates[0].slice(0, 7) === dates[dates.length - 1].slice(0, 7);
  const first = formatPencilDay(dates[0], !sameMonth || dates.length === 1);
  const last = formatPencilDay(dates[dates.length - 1], true);
  const span = dates.length === 1 ? first : `${first} - ${last}`;
  const noun = allowWeekends ? "day" : "working day";
  return `Pencil ${dates.length === 1 ? first : span} (${dates.length} ${noun}${dates.length === 1 ? "" : "s"})`;
}

export type RangeLine = {
  id: string;
  label: string;
  available: boolean;
  detail: string;
};

export type RangePlan = {
  dates: string[];
  selectable: boolean;
  lines: RangeLine[];
  chosenIds: string[];
};

function shortDay(iso: string) {
  return formatPencilDay(iso, true);
}

/**
 * One crew for the whole range. A resource busy on any day blocks that resource
 * for the start day, and the popover names the days.
 */
export function planRange(
  requirements: JobRequirements,
  resources: PoolResource[],
  busyByDay: Readonly<Record<string, readonly string[]>>,
  start: string,
  installDays: number,
  allowWeekends: boolean,
): RangePlan {
  const dates = workingDaysFrom(start, installDays, allowWeekends);
  const unavailableOn = new Map<string, string[]>();
  const combined = new Set<string>();
  const installers = resources.filter((resource) => resource.resourceType === "installer").map((resource) => resource.id);
  for (const date of dates) {
    const busy = new Set(busyByDay[date] ?? []);
    if (!allowWeekends && isWeekend(date)) {
      for (const id of installers) busy.add(id);
    }
    for (const id of busy) {
      combined.add(id);
      const listed = unavailableOn.get(id) ?? [];
      listed.push(date);
      unavailableOn.set(id, listed);
    }
  }
  const day = planDay(requirements, resources, combined);
  const lines = day.lines.map((line) => {
    const missed = unavailableOn.get(line.id) ?? [];
    return {
      id: line.id,
      label: line.label,
      available: missed.length === 0,
      detail: missed.length === 0 ? "Available" : `Unavailable on ${missed.map(shortDay).join(", ")}`,
    };
  });
  const weekendBlocked = !allowWeekends && dates.some(isWeekend);
  return {
    dates,
    selectable: day.selectable && !weekendBlocked && dates[0] === start,
    lines,
    chosenIds: day.selectable && !weekendBlocked ? day.chosenIds : [],
  };
}
