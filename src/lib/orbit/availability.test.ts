import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planDay, type PoolResource } from "./availability";
import { canOverrideRequirements, deriveJobRequirements, type JobRequirements } from "./requirements";

const pool: PoolResource[] = [
  { id: "lewis", name: "FIXTURE — Lewis", resourceType: "installer", hasLicence: true, insured: false },
  { id: "christian", name: "FIXTURE — Christian", resourceType: "installer", hasLicence: false, insured: false },
  { id: "ben", name: "FIXTURE — Ben", resourceType: "helper", hasLicence: true, insured: false },
  { id: "peter", name: "FIXTURE — Peter", resourceType: "helper", hasLicence: true, insured: false },
  { id: "small", name: "FIXTURE — Transit-sized van", resourceType: "van", hasLicence: false, insured: false },
  { id: "crafter", name: "FIXTURE — VW Crafter LWB", resourceType: "van", hasLicence: false, insured: false },
  { id: "climber", name: "FIXTURE — Stanley Sprinter 275", resourceType: "climber", hasLicence: false, insured: false },
];

const job: JobRequirements = {
  installers: 2,
  licensedDrivers: 1,
  vanSize: "small",
  vanCount: 1,
  stairClimber: true,
};

describe("pricer requirements", () => {
  it("maps crew, van size, van count, and the stair climber", () => {
    const light = deriveJobRequirements(1, [
      { qty: 1, weightKg: 15, longestMm: 1800, wheeled: "Y" },
    ]);
    assert.deepEqual(light, {
      installers: 1,
      licensedDrivers: 1,
      vanSize: "small",
      vanCount: 1,
      stairClimber: false,
    });

    const heavy = deriveJobRequirements(2, [
      { qty: 2, weightKg: 80, longestMm: 2800, wheeled: "N" },
      { qty: 1, weightKg: 400, longestMm: 1200, wheeled: "N" },
    ]);
    assert.equal(heavy.installers, 2);
    assert.equal(heavy.vanSize, "crafter");
    assert.equal(heavy.vanCount, 2);
    assert.equal(heavy.licensedDrivers, 2);
    assert.equal(heavy.stairClimber, true);
  });

  it("lets an owner or ops manager override, and not a sales rep", () => {
    assert.equal(canOverrideRequirements({ opsRole: "sales", isOwner: false }), false);
    assert.equal(canOverrideRequirements({ opsRole: "installer", isOwner: false }), false);
    assert.equal(canOverrideRequirements({ opsRole: "ops_manager", isOwner: false }), true);
    assert.equal(canOverrideRequirements({ opsRole: "admin_owner", isOwner: false }), true);
    assert.equal(canOverrideRequirements({ opsRole: "sales", isOwner: true }), true);
  });
});

describe("resource availability", () => {
  it("selects a day only when every required resource is free", () => {
    const open = planDay(job, pool, new Set());
    assert.equal(open.selectable, true);
    assert.equal(open.summary, "Christian - Available, Lewis - Available, Small van - Available, Stair climber - Available");
    assert.deepEqual(open.chosenIds.sort(), ["christian", "climber", "lewis", "small"].sort());
  });

  it("names the resource that blocks the day", () => {
    const blocked = planDay(job, pool, new Set(["climber"]));
    assert.equal(blocked.selectable, false);
    assert.equal(blocked.chosenIds.length, 0);
    assert.equal(
      blocked.summary,
      "Christian - Available, Lewis - Available, Small van - Available, Stair climber - Unavailable",
    );
  });

  it("does not treat an uninsured helper as a driver", () => {
    const needsTwoDrivers: JobRequirements = { ...job, installers: 1, licensedDrivers: 2, stairClimber: false };
    const plan = planDay(needsTwoDrivers, pool, new Set(["lewis"]));
    assert.equal(plan.selectable, false);
    assert.equal(plan.lines.some((line) => line.label === "Ben"), false);
  });
});
