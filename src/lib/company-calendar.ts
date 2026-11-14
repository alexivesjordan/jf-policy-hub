export const CALENDAR_TYPES = ["annual_leave", "sick", "other_absence", "company_event"] as const;
export type CalendarType = (typeof CALENDAR_TYPES)[number];

export type CalendarItem = {
  id: string;
  entryType: CalendarType;
  name: string | null;
  startsOn: string;
  endsOn: string;
  notes: string | null;
  source: "entry" | "resource";
};

export function calendarTypeLabel(type: CalendarType) {
  if (type === "annual_leave") return "Leave";
  if (type === "sick") return "Sick";
  if (type === "company_event") return "Event";
  return "Away";
}

/** Install-resource unavailability is shown on the company calendar. It is not copied into calendar_entries. */
export function absenceType(reason: string): CalendarType {
  if (reason === "leave") return "annual_leave";
  if (reason === "sickness") return "sick";
  return "other_absence";
}

export function coversDay(item: { startsOn: string; endsOn: string }, day: string) {
  return item.startsOn.slice(0, 10) <= day && item.endsOn.slice(0, 10) >= day;
}
