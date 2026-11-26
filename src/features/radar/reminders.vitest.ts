import { describe, expect, it } from "vitest";
import { calendarDaysUntil, dueReminders, londonDay } from "@/features/radar/reminders";

const base = {
  status: "worth_pursuing",
  ownerId: "00000000-0000-4000-8000-000000000001",
  deadline: "2026-12-20T12:00:00.000Z",
  expectedAwardDate: "2027-01-15",
  already: [] as ("deadline_7" | "deadline_2" | "award")[],
  today: "2026-12-13",
};

describe("radar reminders", () => {
  it("uses a London calendar day", () => {
    expect(londonDay(new Date("2026-06-21T23:30:00.000Z"))).toBe("2026-06-22");
    expect(calendarDaysUntil("2026-12-13", "2026-12-20")).toBe(7);
  });

  it("reminds 7 days and 2 days before the deadline, and on the award date", () => {
    expect(dueReminders(base)).toEqual(["deadline_7"]);
    expect(dueReminders({ ...base, today: "2026-12-18" })).toEqual(["deadline_2"]);
    expect(dueReminders({ ...base, today: "2027-01-15", deadline: "2026-12-01T00:00:00.000Z" })).toEqual(["award"]);
  });

  it("does not repeat a reminder or chase a dismissed or unassigned notice", () => {
    expect(dueReminders({ ...base, already: ["deadline_7"] })).toEqual([]);
    expect(dueReminders({ ...base, status: "dismissed" })).toEqual([]);
    expect(dueReminders({ ...base, ownerId: null })).toEqual([]);
    expect(dueReminders({ ...base, today: "2026-12-01" })).toEqual([]);
    expect(dueReminders({ ...base, today: "2026-12-21", deadline: "2026-12-20T12:00:00.000Z" })).toEqual([]);
  });
});
