/** Same HQ profile as the SO-00490 golden pin-loaded machines. */
export const STRENGTH_HQ_PROFILE = {
  buildLocation: "hq" as const,
  needsAssembly: true,
  crew: 2,
  buildMinutes: 120,
  hqBuildCrew: 2,
  hqBuildMinutes: 120,
  sitePositionMinutes: 45,
};

/** Suggested rows only. Confirmed rows are never rewritten by this rule. */
export function matchesPinLoadedRule(name: string, sku: string) {
  return /^JF-PS-PIN-/i.test(sku.trim()) || /pin-loaded|pin loaded|selectori[sz]ed/i.test(name);
}
