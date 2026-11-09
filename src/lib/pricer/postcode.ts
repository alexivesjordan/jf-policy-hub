/** Rough road miles from the King's Lynn depot (PE30). Stated on every quote. */
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

export function estimateMilesFromKingsLynn(postcode: string): { miles: number; method: string } {
  const compact = postcode.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const outward = compact.replace(/\d[A-Z]{2}$/, "");
  const area = outward.replace(/[0-9].*$/, "");
  const miles = OUTWARD_MILES[area];
  if (miles != null) {
    return {
      miles,
      method: `${area} outward area, planning miles from King's Lynn (PE30)`,
    };
  }
  return {
    miles: 120,
    method: `no outward-area figure for ${area || postcode}; using 120 miles and marking the quote provisional`,
  };
}
