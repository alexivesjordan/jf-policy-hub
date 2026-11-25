export type BankHolidayRule = "on_top" | "inside";

export type LeaveYear = { start: string; end: string };

function parts(iso: string) {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return { year, month, day };
}

export function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDays(iso: string, days: number) {
  const { year, month, day } = parts(iso);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function leaveYearContaining(on: string, month = 5, day = 1): LeaveYear {
  const { year, month: onMonth, day: onDay } = parts(on);
  const startYear = onMonth > month || (onMonth === month && onDay >= day) ? year : year - 1;
  const start = isoDate(startYear, month, day);
  return { start, end: addDays(isoDate(startYear + 1, month, day), -1) };
}

export function isWeekend(iso: string) {
  const { year, month, day } = parts(iso);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

export function eachDate(start: string, end: string) {
  const dates: string[] = [];
  if (end < start) return dates;
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) dates.push(cursor);
  return dates;
}

/** Mon–Fri, excluding bank holidays. A half day takes 0.5 off the first or last working day. */
export function bookedWorkingDays(
  start: string,
  end: string,
  holidays: Iterable<string>,
  halves: { startHalf?: boolean; endHalf?: boolean } = {},
) {
  const closed = new Set(holidays);
  const days = eachDate(start, end).filter((date) => !isWeekend(date) && !closed.has(date));
  if (days.length === 0) return 0;
  if (start === end) return halves.startHalf || halves.endHalf ? 0.5 : 1;
  let total = days.length;
  if (halves.startHalf && days[0] === start) total -= 0.5;
  if (halves.endHalf && days[days.length - 1] === end) total -= 0.5;
  return Math.max(0, total);
}

export function bankHolidaysInsideYear(year: LeaveYear, holidays: Iterable<string>, rule: BankHolidayRule) {
  if (rule === "on_top") return 0;
  const closed = new Set(holidays);
  return eachDate(year.start, year.end).filter((date) => !isWeekend(date) && closed.has(date)).length;
}

export function proratedAllowance(entitlement: number, year: LeaveYear, employedFrom: string | null, employedTo: string | null) {
  const from = employedFrom && employedFrom > year.start ? employedFrom : year.start;
  const to = employedTo && employedTo < year.end ? employedTo : year.end;
  if (to < from) return 0;
  const yearDays = eachDate(year.start, year.end).length;
  const employed = eachDate(from, to).length;
  return Math.round((entitlement * employed) / yearDays * 2) / 2;
}

export function openingBalance(input: {
  entitlement: number;
  carriedOver: number;
  year: LeaveYear;
  holidays: Iterable<string>;
  rule: BankHolidayRule;
}) {
  return input.entitlement + input.carriedOver - bankHolidaysInsideYear(input.year, input.holidays, input.rule);
}

export function carryOver(unused: number, cap: number) {
  return Math.max(0, Math.min(unused, cap));
}

export function bradfordScore(spells: number, daysLost: number) {
  return spells * spells * daysLost;
}

/** A flag only. The screen does not explain the sum. */
export function bradfordReview(spells: number, daysLost: number) {
  return bradfordScore(spells, daysLost) >= 200;
}
