/** November 2026 drafting baseline. Owners replace this with a dated rate version. */
export const SERVICE_RATE_VERSION = "2026-11-11-standalone-v1";

export type ServiceRates = {
  version: string;
  callout: number;
  perMachine: number;
  uplift: number;
  twiceYearlyFactor: number;
  cardioRate: number;
  strengthRate: number;
  rackRate: number;
  extensionFactor: number;
  perSite: number;
  bundleIncentive: number;
  portfolioFactor: number;
};

export const DEFAULT_SERVICE_RATES: ServiceRates = {
  version: SERVICE_RATE_VERSION,
  callout: 99,
  perMachine: 59,
  uplift: 1.08,
  twiceYearlyFactor: 0.92,
  cardioRate: 0.05,
  strengthRate: 0.03,
  rackRate: 0.02,
  extensionFactor: 1.3,
  perSite: 150,
  bundleIncentive: 195,
  portfolioFactor: 0.9,
};

export const SERVICE_CATEGORIES = [
  "jordan_cardio",
  "jordan_cardio_unverified",
  "concept2_cardio",
  "other_cardio_unverified",
  "strength_machine",
  "cable_or_power_rack",
  "adjustable_bench",
  "unresolved_dhz",
  "storage_rack",
  "loose_accessory",
  "flooring",
  "delivery_install",
  "unknown_product",
] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export function isServiceCategory(value: string): value is ServiceCategory {
  return (SERVICE_CATEGORIES as readonly string[]).includes(value);
}

/** PM units per item, before a verified override. */
export function defaultPmUnits(category: ServiceCategory): number {
  if (
    category === "storage_rack" ||
    category === "loose_accessory" ||
    category === "flooring" ||
    category === "delivery_install" ||
    category === "unknown_product"
  ) {
    return 0;
  }
  return 1;
}

export function defaultWarrantyRate(category: ServiceCategory, rates: ServiceRates): number {
  if (category === "jordan_cardio" || category === "jordan_cardio_unverified") return rates.cardioRate;
  if (category === "strength_machine" || category === "unresolved_dhz") return rates.strengthRate;
  if (category === "cable_or_power_rack") return rates.rackRate;
  return 0;
}
