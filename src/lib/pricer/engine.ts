import { deriveJobRequirements, type JobRequirements } from "@/lib/pulse/requirements";
import { compareStays, driverCheck, evaluateCrewPlans, type QuoteBreakdown } from "@/lib/pricer/breakdown";
import type { EffortRow } from "@/lib/pricer/effort-table";
import {
  BEST_CASE_NOTICE,
  EFFORT_TABLE_VERSION,
  PRICER_VERSION,
  RATES,
  SEGMENT_NOT_SET,
  effectiveHourlyRate,
  roundMoney,
} from "@/lib/pricer/rates";
import { estimateMilesFromKingsLynn } from "@/lib/pricer/postcode";

export type Segment = "independent" | "franchisee" | "trade" | "big_corporate";
export type CustomerType = "credit" | "proforma" | "leasing" | null;

export type SiteProfile = {
  stairs: "none" | "1" | "2+";
  access: "easy" | "long_carry" | "tight_or_lift";
  parking: "adjacent" | "short_walk" | "far_or_restricted";
  floorType: "concrete" | "rubber" | "raised_or_sprung";
  pumpTruckRoute: boolean;
  townCentre: boolean;
  openingWidthMm?: number | null;
  openingHeightMm?: number | null;
  climberBooked?: boolean;
  outsideHours?: boolean;
};

export const BEST_CASE_PROFILE: SiteProfile = {
  stairs: "none",
  access: "easy",
  parking: "adjacent",
  floorType: "concrete",
  pumpTruckRoute: false,
  townCentre: false,
  climberBooked: false,
  outsideHours: false,
};

export type QuoteLineInput = {
  sku?: string | null;
  productName: string;
  category?: string | null;
  qty: number;
  /** Test-fixture weight when the effort row has none. Not a Cin7 field. */
  unitWeightKg?: number | null;
};

/** Build assumption for a Cin7 category. Exact SKU rows still win. needsAssembly null means unknown. */
export type CategoryEffortDefault = {
  category: string;
  buildCrew: number;
  buildMinutes: number;
  note: string;
  needsAssembly?: boolean | null;
};

export type PricingConfig = {
  markupIndependent: number;
  markupFranchisee: number;
  markupTrade: number;
  markupBigCorporate: number;
  minJobCharge: number | null;
  marginFloorPct: number | null;
  largeOrderThreshold: number;
  variationRoundingHours: number;
};

export const DEFAULT_PRICING: PricingConfig = {
  markupIndependent: 0.4,
  markupFranchisee: 0.4,
  markupTrade: 0.5,
  markupBigCorporate: 0.8,
  minJobCharge: null,
  marginFloorPct: null,
  largeOrderThreshold: 50000,
  variationRoundingHours: 0.5,
};

export type PriceRequest = {
  mode: "A" | "B";
  lines: QuoteLineInput[];
  postcode: string;
  miles?: number;
  speedMph?: number;
  segment: Segment | null;
  customerType?: CustomerType;
  profile?: SiteProfile;
  orderValue?: number | null;
  pricing?: PricingConfig;
  table: EffortRow[];
  categoryDefaults?: CategoryEffortDefault[];
};

export type ResolvedLine = {
  productName: string;
  qty: number;
  match: "exact" | "category_fallback" | "category_default" | "handling_only" | "dhz_generic" | "unknown" | "missing";
  category: string | null;
  provisional: boolean;
  note: string | null;
  row: EffortRow | null;
};

export type PriceResult = {
  pricerVersion: string;
  effortTableVersion: string;
  mode: "A" | "B";
  notice: string | null;
  blockedReason: string | null;
  finality: "final" | "provisional";
  provisionalItems: string[];
  flags: string[];
  segment: Segment | null;
  markup: number | null;
  minJobCharge: number | null;
  minJobChargeConfigured: boolean;
  marginFloorPrice: number | null;
  marginFloorConfigured: boolean;
  cost: number | null;
  customerPrice: number | null;
  paymentGate: string;
  bigInstall: boolean;
  bigInstallTriggers: string[];
  crew: number | null;
  requirements: JobRequirements | null;
  miles: number | null;
  milesMethod: string | null;
  lines: ResolvedLine[];
  manualPricing: boolean;
  manualReasons: string[];
  breakdown: QuoteBreakdown | null;
  variation: {
    extraPersonHours: number;
    billedHours: number;
    rate: number;
    customerCharge: number | null;
    internalDelta: number | null;
    belowCost: boolean;
    roundingNote: string;
  } | null;
};

const KNOWN_BUILD_CATEGORIES = new Set([
  "bench",
  "rack-rig",
  "storage",
  "cable",
  "cardio",
  "pilates",
  "flooring",
  "strength-selectorised",
  "strength-plate-loaded",
]);

const HANDLING_CATEGORIES = new Set(["weights", "accessory", "bar", "mat"]);

function bandMid(band: string): number | null {
  if (band.startsWith("<25")) return 15;
  if (band.startsWith("25-60")) return 42;
  if (band.startsWith("60-120")) return 90;
  if (band.includes("120")) return 150;
  return null;
}

function markupFor(segment: Segment, pricing: PricingConfig) {
  if (segment === "independent") return pricing.markupIndependent;
  if (segment === "franchisee") return pricing.markupFranchisee;
  if (segment === "trade") return pricing.markupTrade;
  return pricing.markupBigCorporate;
}

function paymentGate(type: CustomerType, orderValue: number | null, threshold: number) {
  const parts = [
    type === "credit"
      ? "Credit account: no payment before booking; invoiced on completion."
      : type === "proforma"
        ? "Proforma: paid in full at least 5 working days before the install."
        : type === "leasing"
          ? "Leasing: finance broker's acceptance letter before ordering; agreement at least 5 working days before."
          : "Customer type not set.",
  ];
  if (orderValue != null && orderValue > threshold) {
    parts.push("Large order: agree a deposit with Alex.");
  }
  return parts.join(" ");
}

function unknownAssembly(line: QuoteLineInput, category: string | null): ResolvedLine {
  const label = category || "Other";
  return {
    productName: line.productName,
    qty: line.qty,
    match: "unknown",
    category: label,
    provisional: true,
    note: "Needs review",
    row: {
      ...defaultRow(line.productName, label, {
        category: label,
        buildCrew: 2,
        buildMinutes: 120,
        note: "Unknown effort. Conservative 2-man, 2-hour assembly.",
      }),
      reviewFlag: "needs-review",
    },
  };
}

function fromCategoryDefault(line: QuoteLineInput, effort: CategoryEffortDefault): ResolvedLine {
  if (effort.needsAssembly === false) {
    return {
      productName: line.productName,
      qty: line.qty,
      match: "handling_only",
      category: effort.category,
      provisional: effort.note.length > 0,
      note: "No assembly. Handling and carry only.",
      row: handlingRow(line.productName, effort.category),
    };
  }
  if (effort.needsAssembly === null) return unknownAssembly(line, effort.category);
  return {
    productName: line.productName,
    qty: line.qty,
    match: "category_default",
    category: effort.category,
    provisional: true,
    note: effort.note,
    row: defaultRow(line.productName, effort.category, effort),
  };
}

function matchLine(line: QuoteLineInput, table: EffortRow[], defaults: CategoryEffortDefault[] = []): ResolvedLine {
  const sku = line.sku?.trim();
  if (sku) {
    const bySku = table.find((row) => row.sku === sku);
    if (bySku) {
      if (bySku.reviewFlag === "needs-review" || bySku.needsAssembly === null) return unknownAssembly(line, bySku.category);
      if (bySku.needsAssembly === false) {
        return {
          productName: line.productName,
          qty: line.qty,
          match: "handling_only",
          category: bySku.category,
          provisional: false,
          note: "No assembly. Handling and carry only.",
          row: bySku,
        };
      }
      return { productName: line.productName, qty: line.qty, match: "exact", category: bySku.category, provisional: false, note: null, row: bySku };
    }
  }

  const name = line.productName.trim().toLowerCase();
  const byName = table.find((row) => row.productName.trim().toLowerCase() === name);
  if (byName) {
    const provisional = Boolean(byName.productLine?.startsWith("DHZ-GENERIC"));
    return {
      productName: line.productName,
      qty: line.qty,
      match: provisional ? "dhz_generic" : "exact",
      category: byName.category,
      provisional,
      note: provisional ? "DHZ figures provisional" : null,
      row: byName,
    };
  }

  const given = line.category?.trim();
  if (given) {
    const cin7Default = defaults.find((item) => item.category === given);
    if (cin7Default) return fromCategoryDefault(line, cin7Default);
    if (/^other$/i.test(given)) return unknownAssembly(line, "Other");
  }
  if (/dhz/i.test(line.productName)) {
    const plate = /plate/i.test(line.productName);
    const standIn = table.find((row) =>
      row.productLine?.startsWith("DHZ-GENERIC") &&
      row.category === (plate ? "strength-plate-loaded" : "strength-selectorised"),
    );
    if (standIn) {
      return {
        productName: line.productName,
        qty: line.qty,
        match: "dhz_generic",
        category: standIn.category,
        provisional: true,
        note: `DHZ figures provisional (${standIn.productName})`,
        row: standIn,
      };
    }
  }

  const category = line.category?.trim() || inferredCategory(line.productName);
  const fid = table.find((row) => row.productName === "FID Bench");
  if (fid && /fid bench/i.test(line.productName)) {
    return {
      productName: line.productName,
      qty: line.qty,
      match: "category_fallback",
      category: "bench",
      provisional: true,
      note: "fallback: FID Bench",
      row: { ...fid, productName: line.productName, sku: line.sku?.trim() || null },
    };
  }

  if (/performance strength/i.test(line.productName) && /pin loaded/i.test(line.productName)) {
    const standIn = table.find((row) => row.productLine?.startsWith("DHZ-GENERIC") && row.category === "strength-selectorised");
    if (standIn) {
      const effort = defaults.find((item) => item.category === standIn.category);
      return {
        productName: line.productName,
        qty: line.qty,
        match: "dhz_generic",
        category: standIn.category,
        provisional: true,
        note: "HQ-built Performance Strength pin-loaded, tail-lift lorry",
        row: {
          ...standIn,
          productName: line.productName,
          sku: line.sku?.trim() || null,
          hqBuildMinutes: effort?.buildMinutes ?? standIn.hqBuildMinutes,
          hqBuildCrew: effort?.buildCrew ?? standIn.hqBuildCrew,
        },
      };
    }
  }

  if (isLooseKit(line.productName)) {
    return {
      productName: line.productName,
      qty: line.qty,
      match: "handling_only",
      category: "weights",
      provisional: true,
      note: "fallback: no build / handling only",
      row: handlingRow(line.productName, "weights"),
    };
  }

  const categoryDefault = defaults.find((item) => item.category === category);
  if (categoryDefault) {
    return {
      productName: line.productName,
      qty: line.qty,
      match: "category_default",
      category,
      provisional: true,
      note: categoryDefault.note,
      row: defaultRow(line.productName, category, categoryDefault),
    };
  }

  if (HANDLING_CATEGORIES.has(category) || /dumbbell|plate set|bumper|bar\b|mat\b/i.test(line.productName)) {
    return {
      productName: line.productName,
      qty: line.qty,
      match: "handling_only",
      category: category || "weights",
      provisional: true,
      note: "fallback: no build / handling only",
      row: handlingRow(line.productName, category || "weights"),
    };
  }

  if (category && (KNOWN_BUILD_CATEGORIES.has(category) || table.some((row) => row.category === category))) {
    const peers = table.filter((row) => row.category === category && !row.productLine?.startsWith("DHZ-GENERIC"));
    if (peers.length > 0) {
      const donor = peers.slice().sort((a, b) => (b.buildMinutes ?? 0) - (a.buildMinutes ?? 0))[0];
      return {
        productName: line.productName,
        qty: line.qty,
        match: "category_fallback",
        category,
        provisional: true,
        note: `fallback: ${category}`,
        row: {
          ...donor,
          productName: line.productName,
          sku: null,
          buildMinutes: Math.max(...peers.map((row) => row.buildMinutes ?? 0)),
          buildCrew: Math.max(...peers.map((row) => row.buildCrew ?? 1)),
          carryCrew: Math.max(...peers.map((row) => row.carryCrew ?? 1)),
        },
      };
    }
  }

  return unknownAssembly(line, category || null);
}

function inferredCategory(name: string) {
  if (/treadmill|bike|elliptical|skierg|rowerg|cardio/i.test(name)) return "cardio";
  if (/rack/i.test(name)) return "rack-rig";
  if (/bench/i.test(name)) return "bench";
  return "";
}

function isLooseKit(name: string) {
  if (/rack/i.test(name)) return false;
  return /dumbbell|kettlebell|fixed barbell|bumper|slam ball|battle rope|power band|floor stand/i.test(name);
}

function defaultRow(productName: string, category: string, effort: CategoryEffortDefault): EffortRow {
  return {
    sku: null,
    productName,
    productLine: null,
    category,
    buildLocation: "site",
    crateAtHq: false,
    buildCrew: effort.buildCrew,
    buildMinutes: effort.buildMinutes,
    hqBuildCrew: null,
    hqBuildMinutes: null,
    sitePositionMinutes: null,
    complexity: "med",
    carryCrew: effort.buildCrew,
    weightBand: "",
    unitWeightKg: null,
    assembledWeightKg: null,
    assembledDimsMm: null,
    wheeled: null,
    carryDifficulty: "med",
    pumpTruckOk: false,
    floorFixing: "N",
    reviewFlag: null,
  };
}

function handlingRow(productName: string, category: string): EffortRow {
  return {
    sku: null,
    productName,
    productLine: null,
    category,
    buildLocation: "site",
    crateAtHq: false,
    buildCrew: 1,
    buildMinutes: 0,
    hqBuildCrew: null,
    hqBuildMinutes: null,
    sitePositionMinutes: null,
    complexity: "low",
    carryCrew: 2,
    weightBand: "25-60kg",
    unitWeightKg: null,
    assembledWeightKg: null,
    assembledDimsMm: null,
    wheeled: "N",
    carryDifficulty: "high",
    pumpTruckOk: true,
    floorFixing: "N",
    reviewFlag: "Handling-only fallback. Weight unknown until a table row exists.",
  };
}

function lineWeightKg(row: EffortRow): { kg: number | null; estimated: boolean } {
  if (row.buildLocation === "hq" && row.assembledWeightKg != null) {
    return { kg: row.assembledWeightKg, estimated: false };
  }
  if (row.unitWeightKg != null) return { kg: row.unitWeightKg, estimated: false };
  if (row.category === "weights") return { kg: null, estimated: false };
  const mid = bandMid(row.weightBand);
  return { kg: mid, estimated: mid != null };
}

function affected(row: EffortRow) {
  const heavy = row.weightBand.startsWith("60-120") || row.weightBand.includes("120");
  return heavy || row.wheeled === "N" || row.carryDifficulty === "high" || row.buildLocation === "hq";
}

function stairsMinutes(profile: SiteProfile, row: EffortRow) {
  if (profile.stairs === "none") return 0;
  const weight = row.assembledWeightKg ?? row.unitWeightKg ?? bandMid(row.weightBand) ?? 0;
  const eligible = weight > 0 && weight <= RATES.climberKg;
  if (profile.climberBooked && eligible) return profile.stairs === "1" ? 5 : 12;
  return profile.stairs === "1" ? 10 : 25;
}

function accessMinutes(profile: SiteProfile) {
  if (profile.access === "long_carry") return 10;
  if (profile.access === "tight_or_lift") return 15;
  return 0;
}

function parkingMinutes(profile: SiteProfile) {
  if (profile.parking === "short_walk") return 5;
  if (profile.parking === "far_or_restricted") return 15;
  return 0;
}

function floorMinutes(profile: SiteProfile, row: EffortRow) {
  if (row.floorFixing === "N") return 0;
  if (profile.floorType === "rubber") return 10;
  if (profile.floorType === "raised_or_sprung") return 20;
  return 0;
}

type StageLine = { productName: string; qty: number; minutes: number };

type Costed = {
  cost: number;
  crew: number;
  sitePersonMinutes: number;
  prepMinutes: number;
  buildLines: StageLine[];
  positionLines: StageLine[];
  carryMinutes: number;
  hqLines: { productName: string; qty: number; minutes: number; crew: number }[];
  hqPersonHours: number;
  hqCrateHours: number;
  hqLabour: number;
  hqContingency: number;
  hqCost: number;
  labour: number;
  vehicle: number;
  freight: number;
  consumables: number;
  contingencyRate: number;
  vans: number;
  days: number;
  nights: number;
  hotel: number;
  food: number;
  speedMph: number;
  wallClockHours: number;
  flags: string[];
  provisional: string[];
  bigInstallTriggers: string[];
  manualReasons: string[];
};

function applyLineWeight(line: QuoteLineInput, resolved: ResolvedLine): ResolvedLine {
  if (line.unitWeightKg == null || !resolved.row || resolved.row.buildLocation === "hq" || resolved.row.unitWeightKg != null) {
    return resolved;
  }
  return { ...resolved, row: { ...resolved.row, unitWeightKg: line.unitWeightKg } };
}

function costJob(lines: ResolvedLine[], profile: SiteProfile, miles: number, speedMph: number = RATES.effectiveSpeedMph): Costed {
  const flags: string[] = [];
  const provisional = new Set<string>();
  const manualReasons: string[] = [];
  let maxCrew = 1;
  let onSiteMinutes = RATES.sitePrepMinutes;
  const buildLines: StageLine[] = [];
  const positionLines: StageLine[] = [];
  provisional.add("site_prep_minutes");
  flags.push("handover_minutes is UNSET and excluded");
  let carryPersonMinutes = 0;
  let kitKg = 0;
  let siteBuildKg = 0;
  let looseKg = 0;
  let hqUnits = 0;
  let unknownWeight = false;
  let high = false;
  let hasFlooring = false;
  let hasEquipment = false;
  let hasHq = false;

  for (const line of lines) {
    const row = line.row;
    if (!row) continue;
    if (line.provisional && line.note) provisional.add(line.note);
    if (row.reviewFlag && row.reviewFlag !== "needs-review") flags.push(`${row.productName}: ${row.reviewFlag}`);
    if (row.complexity === "high") high = true;
    if (row.category === "flooring") hasFlooring = true;
    else hasEquipment = true;
    if (row.buildLocation === "hq") hasHq = true;

    const carryCrew = profile.pumpTruckRoute && row.pumpTruckOk ? 1 : (row.carryCrew ?? 1);
    const effective = row.buildLocation === "hq" ? carryCrew : Math.max(row.buildCrew ?? 1, carryCrew);
    maxCrew = Math.max(maxCrew, effective);

    const base = row.buildLocation === "hq" ? (row.sitePositionMinutes ?? 0) : (row.buildMinutes ?? 0);
    const repeated = base * (1 + (line.qty - 1) * RATES.repeatRate);
    onSiteMinutes += repeated;
    const stage = { productName: line.productName, qty: line.qty, minutes: roundMoney(repeated) };
    if (row.buildLocation === "hq") positionLines.push(stage);
    else buildLines.push(stage);

    const add = (stairsMinutes(profile, row) + accessMinutes(profile) + parkingMinutes(profile) + floorMinutes(profile, row)) * line.qty;
    if (affected(row)) carryPersonMinutes += add;

    const weight = lineWeightKg(row);
    if (weight.kg == null) {
      unknownWeight = true;
      flags.push(`weight unknown on ${line.productName}`);
    } else {
      kitKg += weight.kg * line.qty;
      if (row.buildLocation === "hq") hqUnits += line.qty;
      else if (line.match === "handling_only") looseKg += weight.kg * line.qty;
      else siteBuildKg += weight.kg * line.qty;
      if (weight.estimated) {
        flags.push(`weight estimated from band on ${line.productName}`);
        provisional.add("weight_band midpoint");
      }
    }

    const travelWeight = row.assembledWeightKg ?? row.unitWeightKg ?? 0;
    if (profile.stairs !== "none" && travelWeight > RATES.climberKg) {
      manualReasons.push(`${line.productName} is over ${RATES.climberKg} kg on stairs — price by hand`);
    }
    if (row.buildLocation === "hq" && profile.openingWidthMm && profile.openingHeightMm && row.assembledDimsMm) {
      const dims = row.assembledDimsMm.split("x").map((part) => Number(part));
      const [length, width, height] = dims;
      if (length && width && height) {
        const narrow = Math.min(length, width);
        if (narrow > profile.openingWidthMm || height > profile.openingHeightMm) {
          manualReasons.push(`${line.productName} fails the door-fit check — price by hand`);
        }
      }
    }
  }

  if (maxCrew > RATES.dedicatedInstallers + RATES.warehousePullMax) {
    return {
      cost: 0,
      crew: maxCrew,
      sitePersonMinutes: 0,
      prepMinutes: RATES.sitePrepMinutes,
      buildLines,
      positionLines,
      carryMinutes: carryPersonMinutes,
      hqLines: [],
      hqPersonHours: 0,
      hqCrateHours: 0,
      hqLabour: 0,
      hqContingency: 0,
      hqCost: 0,
      labour: 0,
      vehicle: 0,
      freight: 0,
      consumables: 0,
      contingencyRate: 0,
      vans: 1,
      days: 0,
      nights: 0,
      hotel: 0,
      food: 0,
      speedMph,
      wallClockHours: 0,
      flags: ["Subcontractor price pending — crew is above the in-house threshold."],
      provisional: [],
      bigInstallTriggers: [],
      manualReasons,
    };
  }

  const tripMinutes = profile.stairs === "none" ? 1.5 : profile.stairs === "1" ? 2.25 : 2.75;
  const carryWallMinutes = maxCrew > 0 ? (looseKg / 22) * tripMinutes / maxCrew : 0;
  const unpackWallMinutes = maxCrew > 0 ? (siteBuildKg / 100) * 5 / maxCrew : 0;
  onSiteMinutes += carryWallMinutes + unpackWallMinutes;

  const sitePersonMinutes = onSiteMinutes * maxCrew + carryPersonMinutes;
  const wallClockHours = onSiteMinutes / 60;
  const travelHours = (miles * 2) / speedMph;
  const doorToDoor = travelHours + wallClockHours;
  const hourly = effectiveHourlyRate();
  const vans = 1;
  const roundTripMiles = miles * 2;
  const siteKitKg = siteBuildKg + looseKg;
  const overflowKg = Math.max(0, siteKitKg - vans * RATES.vanPayloadKg);
  const sitePallets = overflowKg > 0 ? Math.ceil(overflowKg / RATES.palletCapacityKg) : 0;
  const freight = sitePallets * RATES.palletRate;
  if (hqUnits > 0) {
    flags.push(`${hqUnits} assembled units need oversized pallets. oversize_pallet_rate is UNSET — needs a Lynnstar per-job quote.`);
  }
  let days = 1;
  let nights = 0;
  let hotel = 0;
  let food = 0;
  let labour = 0;
  let vehicle = roundTripMiles * RATES.vehicleRate * vans;
  if (doorToDoor <= RATES.dayThresholdHours) {
    const ordinary = Math.min(doorToDoor, 8);
    const overtime = Math.max(0, doorToDoor - 8);
    labour = maxCrew * (ordinary * hourly + overtime * hourly * RATES.overtimeMultiplier);
    flags.push("food_trigger is UNSET; food was not applied");
  } else {
    const choice = evaluateCrewPlans({
      siteHours: wallClockHours,
      travelHours,
      roundTripMiles,
      crew: maxCrew,
      vans,
      freight: 0,
      consumables: 0,
      contingency: 0,
      hourly,
    }).chosen;
    days = choice.days;
    nights = choice.nights;
    labour = choice.labour;
    vehicle = choice.vehicle;
    hotel = choice.hotel;
    food = choice.food;
    flags.push(`Crew plan: ${choice.label}. ${days} days, ${nights} nights.`);
  }
  const machines = lines.filter((line) => line.row && line.row.category !== "weights" && line.row.category !== "flooring").reduce((sum, line) => sum + line.qty, 0);
  const consumables = machines * RATES.tagCost;
  provisional.add("tag_cost_per_unit");
  flags.push("cover_cost_per_unit and leave_behind_pack_cost are UNSET and excluded");

  let contingency = RATES.contingencyBase;
  provisional.add("contingency_base");
  if (high) {
    contingency += RATES.contingencyHigh;
    provisional.add("contingency_high_complexity");
  }
  if (profile.access === "tight_or_lift" || profile.stairs === "2+") {
    contingency += RATES.contingencyAccess;
    provisional.add("contingency_difficult_access");
  }
  const siteCost = (labour + vehicle + freight + consumables + hotel + food) * (1 + contingency);

  let hqCost = 0;
  let hqLabour = 0;
  let hqCrateHours = 0;
  const hqLines: { productName: string; qty: number; minutes: number; crew: number }[] = [];
  for (const line of lines) {
    const row = line.row;
    if (!row) continue;
    if (row.buildLocation === "hq" && row.hqBuildMinutes != null && row.hqBuildCrew != null) {
      const minutes = row.hqBuildMinutes * (1 + (line.qty - 1) * RATES.repeatRate);
      const personHours = (minutes * row.hqBuildCrew) / 60;
      hqLines.push({ productName: line.productName, qty: line.qty, minutes: roundMoney(minutes), crew: row.hqBuildCrew });
      hqLabour += personHours * hourly;
      hqCost += personHours * hourly;
      if (row.productLine?.startsWith("DHZ-GENERIC")) provisional.add("DHZ generic HQ build");
    }
    if (row.crateAtHq) {
      const weight = lineWeightKg(row);
      if (weight.kg != null) {
        const personHours = ((weight.kg * line.qty) / 100) * 6 / 60;
        hqCrateHours += personHours;
        hqLabour += personHours * hourly;
        hqCost += personHours * hourly;
        provisional.add("hq_unpack_crate_minutes_per_100kg");
      }
    }
  }
  const hqContingency = hqCost > 0 ? hqCost * RATES.contingencyBase : 0;
  if (hqCost > 0) {
    hqCost *= 1 + RATES.contingencyBase;
    flags.push("hq_handling_minutes and deck_cost_per_unit are UNSET and excluded");
  }

  const triggers: string[] = [];
  if (hasEquipment && hasFlooring) triggers.push("kit_and_flooring");
  if (kitKg > 2000) triggers.push("weight_over_2000kg");
  else if (unknownWeight) flags.push("weight unknown on some lines — big-install check incomplete");
  if (profile.townCentre) triggers.push("town_or_city_centre");
  if (profile.stairs !== "none" || profile.access === "tight_or_lift") triggers.push("non_ground_or_stairs");
  if (hasHq) triggers.push("assembled_dhz");

  if (profile.stairs !== "none" && manualReasons.length === 0 && lines.some((line) => (line.row?.assembledWeightKg ?? 0) > RATES.climberKg)) {
    manualReasons.push("A climber-ineligible unit is on stairs");
  }

  return {
    cost: roundMoney(siteCost + hqCost),
    crew: maxCrew,
    sitePersonMinutes,
    prepMinutes: RATES.sitePrepMinutes,
    buildLines,
    positionLines,
    carryMinutes: carryPersonMinutes,
    hqLines,
    hqPersonHours: roundMoney(hqLabour / hourly),
    hqCrateHours: roundMoney(hqCrateHours),
    hqLabour: roundMoney(hqLabour),
    hqContingency: roundMoney(hqContingency),
    hqCost: roundMoney(hqCost),
    labour: roundMoney(labour),
    vehicle: roundMoney(vehicle),
    freight: roundMoney(freight),
    consumables: roundMoney(consumables),
    contingencyRate: contingency,
    vans,
    days,
    nights,
    hotel: roundMoney(hotel),
    food: roundMoney(food),
    speedMph,
    wallClockHours: roundMoney(wallClockHours),
    flags: [...new Set(flags)],
    provisional: [...provisional],
    bigInstallTriggers: triggers,
    manualReasons,
  };
}

export function priceInstall(request: PriceRequest): PriceResult {
  const pricing = request.pricing ?? DEFAULT_PRICING;
  const profile = request.mode === "A" ? BEST_CASE_PROFILE : (request.profile ?? BEST_CASE_PROFILE);
  const distance = request.miles != null
    ? { miles: request.miles, method: "miles supplied with the request", speedMph: request.speedMph ?? RATES.effectiveSpeedMph }
    : estimateMilesFromKingsLynn(request.postcode);
  const resolved = request.lines.map((line) => applyLineWeight(line, matchLine(line, request.table, request.categoryDefaults ?? [])));
  const review = resolved.filter((line) => line.match === "unknown" || line.row?.reviewFlag === "needs-review");

  const base: PriceResult = {
    pricerVersion: PRICER_VERSION,
    effortTableVersion: EFFORT_TABLE_VERSION,
    mode: request.mode,
    notice: request.mode === "A" ? BEST_CASE_NOTICE : null,
    blockedReason: null,
    finality: "provisional",
    provisionalItems: [],
    flags: [],
    segment: request.segment,
    markup: null,
    minJobCharge: pricing.minJobCharge,
    minJobChargeConfigured: pricing.minJobCharge != null,
    marginFloorPrice: null,
    marginFloorConfigured: pricing.marginFloorPct != null,
    cost: null,
    customerPrice: null,
    paymentGate: paymentGate(request.customerType ?? null, request.orderValue ?? null, pricing.largeOrderThreshold),
    bigInstall: false,
    bigInstallTriggers: [],
    crew: null,
    requirements: null,
    miles: distance.miles,
    milesMethod: distance.method,
    lines: resolved,
    manualPricing: false,
    manualReasons: [],
    breakdown: null,
    variation: null,
  };

  if (!request.segment) {
    return { ...base, blockedReason: SEGMENT_NOT_SET };
  }

  const costed = costJob(resolved, profile, distance.miles, distance.speedMph);
  if (costed.crew > RATES.dedicatedInstallers + RATES.warehousePullMax) {
    return {
      ...base,
      crew: costed.crew,
      requirements: requirementsFor(resolved, costed.crew),
      blockedReason: "Subcontractor price pending. No in-house price — the crew is above the outsource threshold.",
      flags: costed.flags,
    };
  }

  const markup = markupFor(request.segment, pricing);
  const markedUp = costed.cost * (1 + markup);
  const customerPrice = pricing.minJobCharge != null ? Math.max(markedUp, pricing.minJobCharge) : markedUp;
  const floor = pricing.marginFloorPct != null ? roundMoney(costed.cost * (1 + pricing.marginFloorPct)) : null;
  const flags = [...costed.flags];
  if (review.length > 0) {
    const names = review.map((line) => line.productName);
    const shown = names.slice(0, 30).join(", ");
    flags.push(`Needs review: ${shown}${names.length > 30 ? `, and ${names.length - 30} more` : ""}. Confirm them on the Pricing page.`);
  }
  if (pricing.minJobCharge == null) flags.push("min job charge not set");
  if (pricing.marginFloorPct == null) flags.push("margin floor not set");
  if (distance.method.includes("120 miles")) flags.push(distance.method);

  const provisionalItems = [...new Set(costed.provisional.concat(resolved.filter((line) => line.provisional).map((line) => line.note ?? line.productName)))];
  const finality = provisionalItems.length === 0 && !distance.method.includes("120 miles") ? "final" : "provisional";

  return {
    ...base,
    finality,
    provisionalItems,
    flags,
    markup,
    marginFloorPrice: floor,
    cost: costed.cost,
    customerPrice: roundMoney(customerPrice),
    bigInstall: costed.bigInstallTriggers.length > 0,
    bigInstallTriggers: costed.bigInstallTriggers,
    crew: costed.crew,
    requirements: requirementsFor(resolved, costed.crew),
    breakdown: describeBreakdown(resolved, costed, distance, request, flags, paymentGate(request.customerType ?? null, request.orderValue ?? null, pricing.largeOrderThreshold)),
    manualPricing: request.mode === "B" && costed.manualReasons.length > 0,
    manualReasons: costed.manualReasons,
  };
}

export function priceVariation(request: Omit<PriceRequest, "mode" | "profile"> & { profile: SiteProfile }): PriceResult {
  const best = priceInstall({ ...request, mode: "A", profile: BEST_CASE_PROFILE });
  const actual = priceInstall({ ...request, mode: "B", profile: request.profile });
  if (best.blockedReason || actual.blockedReason || best.cost == null || actual.cost == null) {
    return { ...actual, mode: "B", notice: null, variation: null };
  }

  const bestCostedMinutes = personMinutes(request.lines, request.table, BEST_CASE_PROFILE, request.miles ?? estimateMilesFromKingsLynn(request.postcode).miles);
  const actualMinutes = personMinutes(request.lines, request.table, request.profile, request.miles ?? estimateMilesFromKingsLynn(request.postcode).miles);
  const extraPersonHours = Math.max(0, (actualMinutes.personMinutes - bestCostedMinutes.personMinutes) / 60);
  const crew = Math.max(1, actual.crew ?? 1);
  const perInstaller = extraPersonHours / crew;
  const increment = request.pricing?.variationRoundingHours ?? 0.5;
  const billedEach = perInstaller <= 0 ? 0 : Math.ceil(perInstaller / increment - 1e-9) * increment;
  const billedHours = roundMoney(billedEach * crew);
  const rate = request.profile.outsideHours ? RATES.installerHourOoh : RATES.installerHour;
  const gridCharge = roundMoney(billedHours * rate);
  const internalDelta = roundMoney(Math.max(0, actual.cost - best.cost));
  const manual = actual.manualReasons.length > 0;

  return {
    ...actual,
    mode: "B",
    notice: null,
    manualPricing: manual,
    customerPrice: manual ? null : gridCharge,
    variation: {
      extraPersonHours: roundMoney(extraPersonHours),
      billedHours,
      rate,
      customerCharge: manual ? null : gridCharge,
      internalDelta,
      belowCost: !manual && gridCharge < internalDelta,
      roundingNote: `Rounded up to the next ${increment} h per installer. The T&Cs do not state a billing increment; this rounding is proposed.`,
    },
  };
}

function personMinutes(lines: QuoteLineInput[], table: EffortRow[], profile: SiteProfile, miles: number) {
  const resolved = lines.map((line) => matchLine(line, table));
  const costed = costJob(resolved, profile, miles);
  return { personMinutes: costed.sitePersonMinutes };
}

/** Sales never receive cost, markup, or the discount floor. */
export function effortRowForSku(input: {
  sku: string;
  productName: string;
  category: string | null;
  needsAssembly: boolean | null;
  crew: number | null;
  buildMinutes: number | null;
}): EffortRow {
  const category = input.category || "Other";
  if (input.needsAssembly === null || /^other$/i.test(category)) {
    return {
      ...defaultRow(input.productName, category, { category, buildCrew: 2, buildMinutes: 120, note: "Unknown", needsAssembly: null }),
      sku: input.sku,
      needsAssembly: null,
      reviewFlag: "needs-review",
    };
  }
  if (input.needsAssembly === false) {
    return {
      ...handlingRow(input.productName, category),
      sku: input.sku,
      needsAssembly: false,
      buildCrew: input.crew ?? 1,
      buildMinutes: 0,
    };
  }
  return {
    ...defaultRow(input.productName, category, {
      category,
      buildCrew: input.crew ?? 2,
      buildMinutes: input.buildMinutes ?? 120,
      note: "SKU effort",
      needsAssembly: true,
    }),
    sku: input.sku,
    needsAssembly: true,
  };
}

export function forSales(result: PriceResult) {
  return {
    pricerVersion: result.pricerVersion,
    effortTableVersion: result.effortTableVersion,
    mode: result.mode,
    notice: result.notice,
    blockedReason: result.blockedReason,
    finality: result.finality,
    customerPrice: result.customerPrice,
    paymentGate: result.paymentGate,
    bigInstall: result.bigInstall,
    provisional: result.finality === "provisional",
    requirements: result.requirements,
  };
}

function describeBreakdown(
  lines: ResolvedLine[],
  costed: Costed,
  distance: { miles: number; method: string; speedMph: number },
  request: PriceRequest,
  flags: string[],
  gate: string,
): QuoteBreakdown {
  const onSiteMinutes = costed.prepMinutes + costed.buildLines.reduce((sum, line) => sum + line.minutes, 0) + costed.positionLines.reduce((sum, line) => sum + line.minutes, 0);
  const stays = compareStays({
    onSiteMinutes,
    carryMinutes: costed.carryMinutes,
    miles: distance.miles,
    speedMph: distance.speedMph,
    crew: costed.crew,
    vans: costed.vans,
    consumables: costed.consumables,
    freight: costed.freight,
    contingency: costed.contingencyRate,
  });
  const unset = [
    "handover_minutes",
    "cover_cost_per_unit",
    "leave_behind_pack_cost",
    "food_trigger",
    "hq_handling_minutes",
    "deck_cost_per_unit",
    "crate_capacity_kg",
    "lorry_tail_lift_kg",
  ];
  if (request.pricing?.minJobCharge == null && request.pricing !== undefined) unset.push("min_job_charge");
  if ((request.pricing ?? DEFAULT_PRICING).minJobCharge == null) {
    if (!unset.includes("min_job_charge")) unset.push("min_job_charge");
  }
  if ((request.pricing ?? DEFAULT_PRICING).marginFloorPct == null) unset.push("margin_floor_pct");
  return {
    classified: lines.map((line) => ({
      productName: line.productName,
      qty: line.qty,
      category: line.category,
      match: line.match,
      buildCrew: line.row?.buildCrew ?? null,
      buildMinutes: line.row?.buildMinutes ?? null,
      note: line.note,
    })),
    prepMinutes: costed.prepMinutes,
    buildLines: costed.buildLines,
    positionLines: costed.positionLines,
    handover: "UNSET",
    onSiteHours: costed.wallClockHours,
    carryHours: roundMoney(costed.carryMinutes / 60),
    hq: costed.hqCost > 0 || costed.hqLines.length > 0
      ? {
          lines: costed.hqLines,
          personHours: costed.hqPersonHours,
          labour: costed.hqLabour,
          crateHours: costed.hqCrateHours,
          crates: "TBC",
          materials: "UNSET",
          handling: "UNSET",
          transport: "Tail-lift lorry is the default. lorry_tail_lift_kg is UNSET, so the check is flagged and not priced.",
          contingency: costed.hqContingency,
          subtotal: costed.hqCost,
        }
      : null,
    crew: costed.crew,
    vans: costed.vans,
    licensedDrivers: costed.vans,
    driverCheck: driverCheck(costed.vans),
    roundTripMiles: roundMoney(distance.miles * 2),
    milesMethod: distance.method,
    speedMph: distance.speedMph,
    travelHours: roundMoney((distance.miles * 2) / distance.speedMph),
    days: costed.days,
    nights: costed.nights,
    hotel: costed.hotel,
    food: costed.food,
    doorToDoorHours: stays.singleShift.doorToDoorHours,
    overnight: costed.nights > 0,
    labour: costed.labour,
    vehicle: costed.vehicle,
    freight: costed.freight,
    consumables: costed.consumables,
    contingencyRate: costed.contingencyRate,
    siteContingency: roundMoney((costed.labour + costed.vehicle + costed.freight + costed.consumables + costed.hotel + costed.food) * costed.contingencyRate),
    siteCost: roundMoney(costed.cost - costed.hqCost),
    hqCost: costed.hqCost,
    singleShift: stays.singleShift,
    commute: stays.commute,
    stayOvernight: stays.stayOvernight,
    crewPlans: crewPlanTable(costed, distance),
    bigInstall: costed.bigInstallTriggers.length > 0,
    bigInstallTriggers: costed.bigInstallTriggers,
    paymentGate: gate,
    assumptions: [...new Set(costed.provisional)],
    unset: [...unset, ...flags.filter((flag) => /UNSET|not set|not configured/i.test(flag))],
  };
}

function crewPlanTable(
  costed: Costed,
  distance: { miles: number; speedMph: number },
): QuoteBreakdown["crewPlans"] {
  const ranked = evaluateCrewPlans({
    siteHours: costed.wallClockHours,
    travelHours: (distance.miles * 2) / distance.speedMph,
    roundTripMiles: distance.miles * 2,
    crew: costed.crew,
    vans: costed.vans,
    freight: costed.freight,
    consumables: costed.consumables,
    contingency: costed.contingencyRate,
    hourly: effectiveHourlyRate(),
  });
  return ranked.plans.map((plan) => ({
    ...plan,
    note: plan.id === ranked.chosen.id ? `${plan.note} Recommended.` : plan.note,
  }));
}

function requirementsFor(lines: ResolvedLine[], crew: number): JobRequirements {
  return deriveJobRequirements(
    crew,
    lines.map((line) => ({
      qty: line.qty,
      weightKg: line.row ? lineWeightKg(line.row).kg : null,
      longestMm: longestMillimetre(line.row?.assembledDimsMm ?? null),
      wheeled: line.row?.wheeled ?? null,
      hq: line.row?.buildLocation === "hq",
      longLoad: line.row?.category === "rack-rig" || /rack/i.test(line.productName),
    })),
  );
}

function longestMillimetre(dims: string | null): number | null {
  if (!dims) return null;
  const values = dims.split(/x/i).map((part) => Number(part)).filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.max(...values) : null;
}
