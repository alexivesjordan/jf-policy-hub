import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PoolResource } from "./availability";
import {
  isWeekend,
  pencilConfirmLabel,
  planRange,
  weekendBookingError,
  workingDaysFrom,
} from "./booking-range";
import type { JobRequirements } from "./requirements";

const pool: PoolResource[] = [
  { id: "lewis", name: "FIXTURE — Lewis", resourceType: "installer", hasLicence: true, insured: false },
  { id: "christian", name: "FIXTURE — Christian", resourceType: "installer", hasLicence: false, insured: false },
  { id: "small", name: "FIXTURE — Transit-sized van", resourceType: "van", hasLicence: false, insured: false },
  { id: "climber", name: "FIXTURE — Stanley Sprinter 275", resourceType: "climber", hasLicence: false, insured: false },
];

const job: JobRequirements = {
  installers: 2,
  licensedDrivers: 1,
  vanSize: "small",
  vanCount: 1,
  stairClimber: true,
};

describe("install range", () => {
  it("books five working days from Tuesday 17 Nov and skips the weekend", () => {
    const dates = workingDaysFrom("2026-11-17", 5, false);
    assert.deepEqual(dates, ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-23"]);
    assert.equal(pencilConfirmLabel(dates, false), "Pencil Tue 17 - Mon 23 Nov (5 working days)");
  });

  it("includes Saturday and Sunday when weekends are allowed", () => {
    const dates = workingDaysFrom("2026-11-20", 3, true);
    assert.deepEqual(dates, ["2026-11-20", "2026-11-21", "2026-11-22"]);
    assert.equal(isWeekend("2026-11-21"), true);
    assert.equal(isWeekend("2026-11-22"), true);
  });

  it("rejects a rep request that includes a weekend", () => {
    assert.equal(weekendBookingError(["2026-11-20"], false), null);
    assert.equal(
      weekendBookingError(["2026-11-21"], false),
      "Weekend installs can only be pencilled by the owner.",
    );
    assert.equal(weekendBookingError(["2026-11-21", "2026-11-22"], true), null);
  });

  it("refuses a start day when a required resource is busy later in the range", () => {
    const open = planRange(job, pool, {}, "2026-11-17", 5, false);
    assert.equal(open.selectable, true);
    assert.equal(open.dates.length, 5);
    assert.equal(open.lines.find((line) => line.id === "climber")?.detail, "Available");

    const blocked = planRange(job, pool, { "2026-11-19": ["climber"] }, "2026-11-17", 5, false);
    assert.equal(blocked.selectable, false);
    assert.equal(blocked.chosenIds.length, 0);
    assert.equal(
      blocked.lines.find((line) => line.id === "climber")?.detail,
      "Unavailable on Thu 19 Nov",
    );
  });
});
