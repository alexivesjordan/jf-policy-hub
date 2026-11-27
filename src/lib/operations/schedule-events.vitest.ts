import { describe, expect, it } from "vitest";
import { scheduleEventClass, serviceScheduleEvent, type ScheduleEvent } from "@/lib/operations/schedule-events";

const lewis = "f3000000-0000-4000-8000-000000000001";
const visit = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

describe("operations schedule service visits", () => {
  it("places a service visit on the assigned engineer, day, and time", () => {
    const event = serviceScheduleEvent({
      resourceId: lewis,
      day: "2026-12-07",
      customerName: "Harbour Gym",
      windowStart: "09:30",
      visitId: visit,
    });
    expect(event).toEqual({
      rowKind: "engineer",
      rowId: lewis,
      day: "2026-12-07",
      kind: "service",
      label: "Service 09:30 · Harbour Gym",
      href: `/service/visits/${visit}`,
    });
  });

  it("keeps a service visit distinct from an install on the same day", () => {
    const install: ScheduleEvent = {
      rowKind: "engineer",
      rowId: lewis,
      day: "2026-12-07",
      kind: "job",
      label: "EXAMPLE-00490",
      href: "/operations/installs/11111111-1111-4111-8111-1111111111a1",
    };
    const service = serviceScheduleEvent({
      resourceId: lewis,
      day: "2026-12-07T00:00:00",
      customerName: "Harbour Gym",
      windowStart: "09:30:00",
      visitId: visit,
    });
    const day = [install, service].filter((event) => event.rowId === lewis && event.day === "2026-12-07");
    expect(day.map((event) => event.kind)).toEqual(["job", "service"]);
    expect(service.label.startsWith("Service")).toBe(true);
    expect(scheduleEventClass(service.kind)).not.toBe(scheduleEventClass(install.kind));
    expect(scheduleEventClass("absence")).toBe("text-red");
  });

  it("still shows a service visit when no clock time was set", () => {
    expect(serviceScheduleEvent({
      resourceId: lewis,
      day: "2026-12-08",
      customerName: "Quay Leisure",
      windowStart: null,
      visitId: visit,
    }).label).toBe("Service · Quay Leisure");
  });
});
