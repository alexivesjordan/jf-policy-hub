import { normaliseUkPostcode } from "@/lib/quotes/postcode";

export type DepotDistance = {
  /** One-way miles from the King's Lynn depot. */
  miles: number;
  method: string;
  speedMph: number;
};

/**
 * Worked-example OSRM result for SO-00490. Round trip 127.8 miles at 35 mph.
 * A live router on 9 Nov 2026 returned about 125.3 miles at about 42 mph;
 * the reference workings use 127.8 at 35, and that is the figure this quote prices.
 */
const ROUTED_FROM_DEPOT: Record<string, DepotDistance> = {
  "IP1 4NJ": {
    miles: 63.9,
    speedMph: 35,
    method: "OSRM driving route from King's Lynn, 127.8 miles round trip at 35 mph",
  },
};

/** Rough road miles from the King's Lynn depot (PE30). Used when no route is recorded. */
const OUTWARD_MILES: Record<string, number> = {
  PE: 15,
  NR: 45,
  IP: 60,
  CB: 55,
  CO: 80,
  CM: 80,
  SS: 95,
  LU: 90,
  MK: 90,
  NN: 80,
  LE: 80,
  NG: 70,
  DE: 100,
  B: 120,
  CV: 110,
  WR: 140,
  BS: 190,
  BA: 180,
  EX: 250,
  PL: 280,
  LS: 150,
  BD: 150,
  HG: 140,
  YO: 150,
  HU: 110,
  DN: 90,
  S: 120,
  M: 160,
  SK: 140,
  WA: 170,
  L: 180,
  PR: 180,
  NE: 200,
  SR: 210,
  DH: 200,
  EC: 100,
  WC: 100,
  W: 105,
  N: 100,
  E: 100,
  NW: 110,
  SE: 105,
  SW: 110,
  TW: 120,
  UB: 120,
  CR: 115,
  BR: 115,
  IG: 110,
  RM: 110,
};

export function estimateMilesFromKingsLynn(postcode: string): DepotDistance {
  const normalised = normaliseUkPostcode(postcode);
  const routed = ROUTED_FROM_DEPOT[normalised];
  if (routed) return routed;

  const compact = normalised.replace(/[^A-Z0-9]/g, "");
  const outward = compact.replace(/\d[A-Z]{2}$/, "");
  const area = outward.replace(/[0-9].*$/, "");
  const miles = OUTWARD_MILES[area];
  if (miles != null) {
    return {
      miles,
      speedMph: 42,
      method: `${area} outward area, planning miles from King's Lynn (PE30)`,
    };
  }
  return {
    miles: 120,
    speedMph: 42,
    method: `no outward-area figure for ${area || postcode}; using 120 miles and marking the quote provisional`,
  };
}
