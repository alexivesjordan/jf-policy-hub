/** Jordan Elite Cardio ships fully built. HQ time is the default; a confirmed SKU row can override it. */
export const ELITE_CARDIO_HQ = {
  buildLocation: "hq" as const,
  hqBuildMinutes: 120,
  hqBuildCrew: 2,
  sitePositionMinutes: 45,
};

export function isEliteCardio(sku?: string | null, name?: string | null) {
  if (/^JF-EC-/i.test((sku ?? "").trim())) return true;
  return /elite\s+cardio/i.test(name ?? "");
}
