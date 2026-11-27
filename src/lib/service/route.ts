/** Approximate road miles from the King's Lynn depot (PE30 4JJ centroid). Not a live router. */

export const DEPOT = {
  id: "depot",
  label: "King's Lynn",
  postcode: "PE30 4JJ",
  latitude: 52.742473,
  longitude: 0.415321,
} as const;

export const ROAD_FACTOR = 1.25;
export const SPEED_MPH = 40;
export const DAY_START_MINUTES = 8 * 60;

export type RouteVisit = {
  id: string;
  latitude: number;
  longitude: number;
  windowStart: string | null;
  windowEnd: string | null;
  durationMinutes: number;
};

export type RouteLeg = {
  fromId: string;
  toId: string;
  miles: number;
  minutes: number;
};

export type RouteFlag = {
  id: string;
  message: string;
};

export type RouteArrival = {
  id: string;
  arrive: string;
  flagged: boolean;
};

export type RouteResult = {
  order: string[];
  legs: RouteLeg[];
  totalMiles: number;
  totalMinutes: number;
  arrivals: RouteArrival[];
  flagged: RouteFlag[];
  label: "approx.";
};

type Point = { latitude: number; longitude: number };

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function clockMinutes(value: string | null | undefined) {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatClock(minutes: number) {
  const day = ((Math.round(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(day / 60);
  const mins = day % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function haversineMiles(from: Point, to: Point) {
  const earth = 3958.7613;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const dLat = lat2 - lat1;
  const dLng = toRad(to.longitude - from.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function roadMiles(from: Point, to: Point) {
  return haversineMiles(from, to) * ROAD_FACTOR;
}

function byId(visits: RouteVisit[]) {
  const map = new Map<string, RouteVisit>();
  for (const visit of visits) {
    if (!map.has(visit.id)) map.set(visit.id, visit);
  }
  return map;
}

type Score = { miles: number; flags: number };

function travel(from: Point, to: Point) {
  const miles = roadMiles(from, to);
  return { miles, minutes: (miles / SPEED_MPH) * 60 };
}

function scoreOrder(order: string[], visits: Map<string, RouteVisit>): Score {
  let point: Point = DEPOT;
  let time = DAY_START_MINUTES;
  let miles = 0;
  let flags = 0;
  for (const id of order) {
    const visit = visits.get(id);
    if (!visit) continue;
    const leg = travel(point, visit);
    miles += leg.miles;
    const arrive = time + leg.minutes;
    const end = clockMinutes(visit.windowEnd);
    if (end != null && arrive > end + 0.5) flags += 1;
    const start = clockMinutes(visit.windowStart);
    const begin = start != null ? Math.max(arrive, start) : arrive;
    time = begin + Math.max(0, visit.durationMinutes);
    point = visit;
  }
  if (order.length > 0) miles += travel(point, DEPOT).miles;
  return { miles, flags };
}

function better(next: Score, current: Score) {
  if (next.flags !== current.flags) return next.flags < current.flags;
  return next.miles < current.miles - 1e-4;
}

function twoOpt(order: string[], visits: Map<string, RouteVisit>) {
  let current = order.slice();
  let guard = 0;
  let improved = true;
  while (improved && guard < 30) {
    improved = false;
    guard += 1;
    const base = scoreOrder(current, visits);
    for (let start = 0; start < current.length - 1 && !improved; start += 1) {
      for (let end = start + 1; end < current.length; end += 1) {
        const candidate = current.slice();
        const reversed = candidate.slice(start, end + 1).reverse();
        candidate.splice(start, end - start + 1, ...reversed);
        const scored = scoreOrder(candidate, visits);
        if (scored.miles < base.miles - 1e-4 && scored.flags <= base.flags) {
          current = candidate;
          improved = true;
          break;
        }
      }
    }
  }
  return current;
}

function nearestNeighbour(visits: Map<string, RouteVisit>, seed: string[]) {
  const remaining = seed.filter((id) => visits.has(id));
  const order: string[] = [];
  let point: Point = DEPOT;
  let time = DAY_START_MINUTES;
  while (remaining.length > 0) {
    let feasible: { index: number; miles: number } | null = null;
    let closest: { index: number; miles: number } | null = null;
    for (let index = 0; index < remaining.length; index += 1) {
      const id = remaining[index];
      const visit = id ? visits.get(id) : undefined;
      if (!visit) continue;
      const leg = travel(point, visit);
      const arrive = time + leg.minutes;
      const end = clockMinutes(visit.windowEnd);
      const ok = end == null || arrive <= end + 0.5;
      if (!closest || leg.miles < closest.miles) closest = { index, miles: leg.miles };
      if (ok && (!feasible || leg.miles < feasible.miles)) feasible = { index, miles: leg.miles };
    }
    const pick = feasible ?? closest;
    if (!pick) break;
    const id = remaining.splice(pick.index, 1)[0];
    if (!id) break;
    order.push(id);
    const visit = visits.get(id);
    if (!visit) break;
    const leg = travel(point, visit);
    const arrive = time + leg.minutes;
    const start = clockMinutes(visit.windowStart);
    const begin = start != null ? Math.max(arrive, start) : arrive;
    time = begin + Math.max(0, visit.durationMinutes);
    point = visit;
  }
  return order;
}

export function describeRoute(visits: RouteVisit[]): RouteResult {
  const visitsById = byId(visits);
  const order = visits.map((visit) => visit.id).filter((id, index, all) => all.indexOf(id) === index && visitsById.has(id));
  let point: Point = DEPOT;
  let time = DAY_START_MINUTES;
  const legs: RouteLeg[] = [];
  const arrivals: RouteArrival[] = [];
  const flagged: RouteFlag[] = [];
  let previous: string = DEPOT.id;
  for (const id of order) {
    const visit = visitsById.get(id);
    if (!visit) continue;
    const leg = travel(point, visit);
    const arrive = time + leg.minutes;
    legs.push({
      fromId: previous,
      toId: id,
      miles: round1(leg.miles),
      minutes: Math.round(leg.minutes),
    });
    const end = clockMinutes(visit.windowEnd);
    const late = end != null && arrive > end + 0.5;
    if (late) flagged.push({ id, message: "After the time window" });
    arrivals.push({ id, arrive: formatClock(arrive), flagged: late });
    const start = clockMinutes(visit.windowStart);
    const begin = start != null ? Math.max(arrive, start) : arrive;
    time = begin + Math.max(0, visit.durationMinutes);
    point = visit;
    previous = id;
  }
  if (order.length > 0) {
    const back = travel(point, DEPOT);
    legs.push({
      fromId: previous,
      toId: DEPOT.id,
      miles: round1(back.miles),
      minutes: Math.round(back.minutes),
    });
  }
  const totalMiles = round1(legs.reduce((sum, leg) => sum + leg.miles, 0));
  const totalMinutes = legs.reduce((sum, leg) => sum + leg.minutes, 0);
  return { order, legs, totalMiles, totalMinutes, arrivals, flagged, label: "approx." };
}

export function planRoute(visits: RouteVisit[]): RouteResult {
  const visitsById = byId(visits);
  const seed = visits.map((visit) => visit.id).filter((id, index, all) => all.indexOf(id) === index && visitsById.has(id));
  if (seed.length < 2) return describeRoute(visits);
  const candidates = [seed, twoOpt(seed, visitsById), nearestNeighbour(visitsById, seed)];
  candidates.push(twoOpt(candidates[2] ?? seed, visitsById));
  let best = seed;
  let bestScore = scoreOrder(seed, visitsById);
  for (const candidate of candidates) {
    const scored = scoreOrder(candidate, visitsById);
    if (better(scored, bestScore)) {
      best = candidate;
      bestScore = scored;
    }
  }
  const ordered = best.flatMap((id) => {
    const visit = visitsById.get(id);
    return visit ? [visit] : [];
  });
  return describeRoute(ordered);
}
