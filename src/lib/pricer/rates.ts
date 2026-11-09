/** Verbatim Mode A notice from install-quoting v2.5. */
export const BEST_CASE_NOTICE =
  "Install price based on best-case access: ground-floor, level, double-door access from the delivery vehicle to the installation room (standard UK double doors: at least 1,400 mm clear width and 1,950 mm clear height), with vehicle parking and a lorry drop zone adjacent to the entrance. Stairs, lifts, longer carries, restricted parking or delivery access, narrower openings and other site conditions that differ are chargeable as set out in the Jordan Fitness Installation Terms and Conditions and the additional-charges grid, confirmed on the access form before the install is scheduled.";

export const SEGMENT_NOT_SET =
  "Customer segment not set: ask Alex/admin to tag the customer in Cin7.";

export const PRICER_VERSION = "v2.5";
export const EFFORT_TABLE_VERSION = "v2.5";

export const RATES = {
  baseWage: 13,
  wageOncost: 1.15,
  overtimeMultiplier: 1.5,
  vehicleRate: 0.45,
  effectiveSpeedMph: 42,
  speedNote: "mixed",
  vanPayloadKg: 500,
  vansAvailable: 2,
  palletRate: 65,
  palletCapacityKg: 400,
  dayThresholdHours: 12,
  sitePrepMinutes: 45,
  repeatRate: 0.8,
  contingencyBase: 0.1,
  contingencyHigh: 0.05,
  contingencyAccess: 0.05,
  tagCost: 0.22,
  /** SET in install-quoting v2.5. Same-day food stays off while food_trigger is UNSET. */
  foodRate: 15,
  hotelRate: 80,
  installerHour: 30,
  installerHourOoh: 45,
  mileageCharge: 0.5,
  dedicatedInstallers: 2,
  warehousePullMax: 3,
  climberKg: 275,
  depot: "King's Lynn",
} as const;

export function effectiveHourlyRate() {
  return roundMoney(RATES.baseWage * RATES.wageOncost);
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function roundUpHalfHour(hours: number) {
  if (hours <= 0) return 0;
  return Math.ceil(hours * 2 - 1e-9) / 2;
}
