import { describe, expect, it } from "vitest";
import { DEPOT, describeRoute, planRoute, roadMiles, type RouteVisit } from "./route";

function stop(id: string, latitude: number, longitude: number, extra: Partial<RouteVisit> = {}): RouteVisit {
  return {
    id,
    latitude,
    longitude,
    windowStart: null,
    windowEnd: null,
    durationMinutes: 45,
    ...extra,
  };
}

/** Eight sites around East Anglia, in a deliberately crossed order. */
const eastAnglia = [
  stop("cambridge", 52.205, 0.119),
  stop("norwich", 52.628, 1.297),
  stop("wisbech", 52.666, 0.16),
  stop("ipswich", 52.056, 1.148),
  stop("lynn", 52.755, 0.398),
  stop("bury", 52.246, 0.712),
  stop("ely", 52.399, 0.262),
  stop("thetford", 52.416, 0.749),
];

describe("service route", () => {
  it("uses a road factor on the straight-line distance and a zero leg at the depot", () => {
    expect(roadMiles(DEPOT, DEPOT)).toBe(0);
    const straight = roadMiles(DEPOT, { latitude: 52.628, longitude: 1.297 });
    expect(straight).toBeGreaterThan(40);
  });

  it("beats or equals the input order on a crossed East Anglia day", () => {
    const input = describeRoute(eastAnglia);
    const planned = planRoute(eastAnglia);
    expect(planned.order).toHaveLength(8);
    expect(planned.label).toBe("approx.");
    expect(planned.totalMiles).toBeLessThanOrEqual(input.totalMiles);
    expect(planned.totalMiles).toBeLessThan(input.totalMiles);
    expect(planned.legs.at(-1)?.toId).toBe("depot");
  });

  it("does not make an already short order longer", () => {
    const planned = planRoute(eastAnglia);
    const ordered = planned.order.flatMap((id) => eastAnglia.filter((visit) => visit.id === id));
    const again = planRoute(ordered);
    expect(again.totalMiles).toBeLessThanOrEqual(planned.totalMiles);
  });

  it("places a time window feasibly when a nearer stop can go first", () => {
    const visits = [
      stop("cromer", 52.933, 1.301, { windowStart: "12:00", windowEnd: "15:00", durationMinutes: 30 }),
      stop("wisbech", 52.666, 0.16, { windowStart: "08:00", windowEnd: "09:30", durationMinutes: 30 }),
    ];
    const input = describeRoute(visits);
    expect(input.flagged.map((flag) => flag.id)).toContain("wisbech");
    const planned = planRoute(visits);
    expect(planned.flagged).toEqual([]);
    expect(planned.order[0]).toBe("wisbech");
    expect(planned.totalMiles).toBeLessThanOrEqual(input.totalMiles);
  });

  it("flags a window the depot cannot reach", () => {
    const visits = [stop("cromer", 52.933, 1.301, { windowStart: "08:00", windowEnd: "08:20" })];
    const planned = planRoute(visits);
    expect(planned.flagged).toEqual([{ id: "cromer", message: "After the time window" }]);
    expect(planned.arrivals[0]?.flagged).toBe(true);
  });
});
