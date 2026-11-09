import { RATES, roundMoney } from "@/lib/pricer/rates";

export type ClassifiedLine = {
  productName: string;
  qty: number;
  category: string | null;
  match: string;
  buildCrew: number | null;
  buildMinutes: number | null;
  note: string | null;
};

export type StayOption = {
  label: string;
  days: number;
  nights: number;
  doorToDoorHours: number;
  labour: number;
  vehicle: number;
  hotel: number;
  food: number;
  cost: number;
  note: string;
};

export type QuoteBreakdown = {
  classified: ClassifiedLine[];
  prepMinutes: number;
  buildLines: { productName: string; qty: number; minutes: number }[];
  positionLines: { productName: string; qty: number; minutes: number }[];
  handover: "UNSET";
  onSiteHours: number;
  carryHours: number;
  hq: {
    lines: { productName: string; qty: number; minutes: number; crew: number }[];
    personHours: number;
    labour: number;
    crateHours: number;
    crates: "TBC";
    materials: "UNSET";
    handling: "UNSET";
    transport: string;
    contingency: number;
    subtotal: number;
  } | null;
  crew: number;
  vans: number;
  licensedDrivers: number;
  driverCheck: string;
  roundTripMiles: number;
  milesMethod: string;
  speedMph: number;
  travelHours: number;
  days: number;
  nights: number;
  hotel: number;
  food: number;
  doorToDoorHours: number;
  overnight: boolean;
  labour: number;
  vehicle: number;
  freight: number;
  consumables: number;
  contingencyRate: number;
  siteContingency: number;
  siteCost: number;
  hqCost: number;
  singleShift: StayOption;
  commute: StayOption;
  stayOvernight: StayOption;
  bigInstall: boolean;
  bigInstallTriggers: string[];
  paymentGate: string;
  assumptions: string[];
  unset: string[];
};

export function compareStays(input: {
  onSiteMinutes: number;
  carryMinutes: number;
  miles: number;
  speedMph?: number;
  crew: number;
  vans: number;
  consumables: number;
  freight: number;
  contingency: number;
}): { singleShift: StayOption; commute: StayOption; stayOvernight: StayOption } {
  const siteHours = (input.onSiteMinutes + input.carryMinutes) / 60;
  const roundTripHours = (input.miles * 2) / (input.speedMph ?? RATES.effectiveSpeedMph);
  const hourly = roundMoney(RATES.baseWage * RATES.wageOncost);
  const overtime = hourly * RATES.overtimeMultiplier;

  const finish = (
    label: string,
    days: number,
    nights: number,
    doorToDoorHours: number,
    labour: number,
    vehicle: number,
    hotel: number,
    food: number,
    note: string,
  ): StayOption => {
    const direct = labour + vehicle + hotel + food + input.consumables + input.freight;
    return {
      label,
      days,
      nights,
      doorToDoorHours: roundMoney(doorToDoorHours),
      labour: roundMoney(labour),
      vehicle: roundMoney(vehicle),
      hotel: roundMoney(hotel),
      food: roundMoney(food),
      cost: roundMoney(direct * (1 + input.contingency)),
      note,
    };
  };

  const shiftHours = roundTripHours + siteHours;
  const singleLabour = input.crew * (Math.min(shiftHours, 8) * hourly + Math.max(0, shiftHours - 8) * overtime);
  const single = finish(
    "Single shift",
    1,
    0,
    shiftHours,
    singleLabour,
    input.miles * 2 * RATES.vehicleRate * input.vans,
    0,
    0,
    "What this quote charges: one door-to-door shift, overtime after 8 hours, no hotel.",
  );

  const daySiteCap = Math.max(0.5, RATES.dayThresholdHours - roundTripHours);
  const commuteDays = Math.max(1, Math.ceil(siteHours / daySiteCap - 1e-9));
  let commuteLeft = siteHours;
  let commuteLabour = 0;
  let commutePeak = 0;
  for (let day = 0; day < commuteDays; day += 1) {
    const site = Math.min(daySiteCap, commuteLeft);
    commuteLeft -= site;
    const door = roundTripHours + site;
    commutePeak = Math.max(commutePeak, door);
    commuteLabour += input.crew * (Math.min(door, 8) * hourly + Math.max(0, door - 8) * overtime);
  }
  const commute = finish(
    "Commute each day",
    commuteDays,
    0,
    commutePeak,
    commuteLabour,
    input.miles * 2 * RATES.vehicleRate * input.vans * commuteDays,
    0,
    0,
    "Travel every day. Food is excluded because food_trigger is UNSET.",
  );

  const overnightDays = Math.max(1, Math.ceil(siteHours / 8 - 1e-9));
  let overnightLeft = siteHours;
  let overnightLabour = 0;
  const oneWay = input.miles / RATES.effectiveSpeedMph;
  for (let day = 0; day < overnightDays; day += 1) {
    const site = Math.min(8, overnightLeft);
    overnightLeft -= site;
    const travel = (day === 0 ? oneWay : 0) + (day === overnightDays - 1 ? oneWay : 0);
    const door = site + travel;
    overnightLabour += input.crew * (Math.min(door, 8) * hourly + Math.max(0, door - 8) * overtime);
  }
  const nights = Math.max(0, overnightDays - 1);
  const stayOvernight = finish(
    "Overnight",
    overnightDays,
    nights,
    oneWay * 2 + siteHours,
    overnightLabour,
    input.miles * 2 * RATES.vehicleRate * input.vans,
    nights * input.crew * RATES.hotelRate,
    overnightDays * input.crew * RATES.foodRate,
    "One round trip. Hotel and food use the v2.5 rates (£80 a night, £15 a day).",
  );

  return { singleShift: single, commute, stayOvernight };
}

export function driverCheck(vans: number): string {
  if (vans > 1) {
    return `DRIVER CONSTRAINT. ${vans} vans need ${vans} licensed drivers. Lewis is the only bookable driver; Ben and Peter are not on the van insurance.`;
  }
  return "SINGLE-DRIVER DEPENDENCY. One van needs one licensed driver. Lewis can drive; Ben and Peter cannot until they are insured.";
}
