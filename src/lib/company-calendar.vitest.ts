import { describe, expect, it } from "vitest";
import { absenceType, calendarTypeLabel, coversDay } from "@/lib/company-calendar";

describe("company calendar", () => {
  it("reads resource holidays without inventing a second type", () => {
    expect(absenceType("leave")).toBe("annual_leave");
    expect(absenceType("sickness")).toBe("sick");
    expect(absenceType("mot")).toBe("other_absence");
    expect(calendarTypeLabel("company_event")).toBe("Event");
  });

  it("includes a day inside the range", () => {
    const item = { startsOn: "2026-11-10", endsOn: "2026-11-12" };
    expect(coversDay(item, "2026-11-11")).toBe(true);
    expect(coversDay(item, "2026-11-13")).toBe(false);
  });
});
