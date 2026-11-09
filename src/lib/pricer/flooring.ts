export type FloorMeasure = {
  qty: number;
  uom: string | null;
  length: number | null;
  width: number | null;
  dimensionUnit: string | null;
  tilesPerPack: number | null;
};

export type FloorQuantity = {
  tiles: number;
  assumed: boolean;
  detail: string | null;
};

function metres(value: number, unit: string | null) {
  const name = (unit ?? "cm").toLowerCase();
  if (name === "mm" || name.startsWith("millimet")) return value / 1000;
  if (name === "m" || name.startsWith("metre") || name.startsWith("meter")) return value;
  return value / 100;
}

/** Turn a sold quantity into tiles. Unconvertible quantities are priced as if they were tiles. */
export function tilesFromSale(input: FloorMeasure): FloorQuantity {
  const uom = (input.uom ?? "").trim().toLowerCase();
  const soldAsTile = uom === "" || /tile|each|item|piece|unit|ea\b/.test(uom);
  if (soldAsTile) {
    return { tiles: input.qty, assumed: uom === "", detail: uom === "" ? "Cin7 UOM was blank, so the quantity was priced as tiles." : null };
  }
  if (/m²|m2|sq\.?\s?m|square/.test(uom)) {
    if (input.length && input.width && input.length > 0 && input.width > 0) {
      const area = metres(input.length, input.dimensionUnit) * metres(input.width, input.dimensionUnit);
      if (area > 0) return { tiles: input.qty / area, assumed: false, detail: null };
    }
    return { tiles: input.qty, assumed: true, detail: `Sold per ${input.uom}, and Cin7 has no tile size, so the quantity was priced as tiles.` };
  }
  if (/pack|box|carton|case/.test(uom)) {
    if (input.tilesPerPack && input.tilesPerPack > 0) {
      return { tiles: input.qty * input.tilesPerPack, assumed: false, detail: null };
    }
    return { tiles: input.qty, assumed: true, detail: `Sold per ${input.uom}, and Cin7 has no tiles-per-pack, so the quantity was priced as tiles.` };
  }
  return { tiles: input.qty, assumed: true, detail: `Cin7 UOM “${input.uom}” could not be converted to tiles, so the quantity was priced as tiles.` };
}

/** A bare number on a product, used only when the field name says it is tiles in a pack. */
export function tilesPerPackFromProduct(product: Record<string, unknown>) {
  for (const [key, value] of Object.entries(product)) {
    if (!/tile/i.test(key) || !/pack|box|carton|case|inner/i.test(key)) continue;
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}
