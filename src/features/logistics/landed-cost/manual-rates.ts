export type ManualRate = {
  destination: string;
  origin: string | null;
  hsPrefix: string;
  dutyPercent: number;
  vatPercent: number;
};

/** Longest commodity prefix. An origin-specific row beats a row for any origin. */
export function matchManualRate(rates: ManualRate[], destination: string, origin: string, commodityCode: string) {
  const code = commodityCode.replace(/\D/g, "");
  const applicable = rates.filter((rate) => {
    if (rate.destination !== destination) return false;
    if (!code.startsWith(rate.hsPrefix)) return false;
    if (rate.origin && rate.origin !== origin) return false;
    return true;
  });
  applicable.sort((left, right) => {
    const prefix = right.hsPrefix.length - left.hsPrefix.length;
    if (prefix !== 0) return prefix;
    return Number(Boolean(right.origin)) - Number(Boolean(left.origin));
  });
  return applicable[0] ?? null;
}
