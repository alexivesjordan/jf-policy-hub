export type ScheduleEvent = {
  rowKind: "engineer" | "van";
  rowId: string;
  day: string;
  kind: string;
  label: string;
  href: string | null;
};

export type ServiceScheduleInput = {
  resourceId: string;
  day: string;
  customerName: string;
  windowStart: string | null;
  visitId: string;
};

/** One schedule cell for an assigned service visit. The label matches public.ops_schedule. */
export function serviceScheduleEvent(input: ServiceScheduleInput): ScheduleEvent {
  const clock = input.windowStart ? input.windowStart.slice(0, 5) : "";
  const name = input.customerName.trim() || "Service";
  return {
    rowKind: "engineer",
    rowId: input.resourceId,
    day: input.day.slice(0, 10),
    kind: "service",
    label: clock ? `Service ${clock} · ${name}` : `Service · ${name}`,
    href: `/service/visits/${input.visitId}`,
  };
}

export function scheduleEventClass(kind: string) {
  if (kind === "absence") return "text-red";
  if (kind === "service") return "inline-block rounded-md bg-paper px-1.5 py-0.5 font-semibold";
  return "";
}
