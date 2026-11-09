/** Sold per square metre. Length is area divided by the track width. */
export const SLED_TRACK_SKUS = ["JF-TT-BST", "JF-TT-CFST", "JF-TT-CGST", "JF-TT-CST", "JF-TT-SST"] as const;

export type SledTrackRates = {
  /** Null until the owner sets a width on the Pricing page. */
  widthM: number | null;
  baseMinutes: number;
  baseLengthM: number;
  extraMinutesPerMetre: number;
};

export const DEFAULT_SLED_RATES: SledTrackRates = {
  widthM: null,
  baseMinutes: 180,
  baseLengthM: 10,
  extraMinutesPerMetre: 6,
};

export function isSledTrack(sku: string | null | undefined, name: string | null | undefined) {
  const code = (sku ?? "").trim().toUpperCase();
  if ((SLED_TRACK_SKUS as readonly string[]).includes(code)) return true;
  return /sled track/i.test(name ?? "");
}

/** 10 m is the base. Each metre past that adds the extra rate. 20 m is 240 minutes at the seeded rates. */
export function sledTrackMinutes(lengthM: number, rates: SledTrackRates = DEFAULT_SLED_RATES) {
  const length = Number.isFinite(lengthM) && lengthM > 0 ? lengthM : 0;
  return rates.baseMinutes + Math.max(0, length - rates.baseLengthM) * rates.extraMinutesPerMetre;
}

function metres(value: number, unit: string | null) {
  const name = (unit ?? "cm").toLowerCase();
  if (name === "mm" || name.startsWith("millimet")) return value / 1000;
  if (name === "m" || name.startsWith("metre") || name.startsWith("meter")) return value;
  return value / 100;
}

/**
 * A filled Cin7 Width wins. Otherwise the Pricing-page width.
 * With neither, the square metres are priced as if they were metres of track.
 */
export function sledTrackLength(input: {
  qty: number;
  uom?: string | null;
  productWidth?: number | null;
  dimensionUnit?: string | null;
  settingsWidthM?: number | null;
}): { lengthM: number; widthUnset: boolean } {
  const uom = (input.uom ?? "").trim().toLowerCase();
  const soldByLength = uom === "m" || uom.startsWith("metre") || uom.startsWith("meter");
  if (soldByLength) return { lengthM: input.qty, widthUnset: false };

  if (input.productWidth != null && input.productWidth > 0) {
    const width = metres(input.productWidth, input.dimensionUnit ?? null);
    if (width > 0) return { lengthM: input.qty / width, widthUnset: false };
  }
  if (input.settingsWidthM != null && input.settingsWidthM > 0) {
    return { lengthM: input.qty / input.settingsWidthM, widthUnset: false };
  }
  return { lengthM: input.qty, widthUnset: true };
}
