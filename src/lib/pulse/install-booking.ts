import { addIsoDays, isWeekend, planRange } from "@/lib/pulse/booking-range";
import type { PoolResource } from "@/lib/pulse/availability";
import type { JobRequirements } from "@/lib/pulse/requirements";

/** Sales Pulse fields. Flags, effort, lines, and the Cin7 id are not in this list. */
export const SALES_INSTALL_FIELDS = [
  "id",
  "orderNumber",
  "goodsNet",
  "installPrice",
  "warrantyOption",
  "warrantyPrice",
  "startOn",
  "endOn",
  "customerName",
  "contactName",
  "contactEmail",
  "contactPhone",
  "siteAddress",
  "status",
  "bookingRepId",
  "bookingRepName",
  "proposalPath",
  "serviceQuoteId",
] as const;

/** Operations Pulse sees the sales fields plus the working detail. */
export const OPS_INSTALL_FIELDS = [
  ...SALES_INSTALL_FIELDS,
  "flags",
  "hqBuild",
  "siteInstall",
  "crew",
  "vans",
  "resources",
  "lines",
  "cin7SaleId",
  "cin7CustomerId",
] as const;

export type SalesInstallField = (typeof SALES_INSTALL_FIELDS)[number];
export type InstallRecord = Record<string, unknown>;
export type WarrantyChoice = "none" | "annual" | "twice_yearly" | "extension" | "annual_bundle" | "twice_yearly_bundle";

export type WarrantyPrices = {
  annual: number | null;
  twice: number | null;
  extension: number | null;
  annualBundle: number | null;
  twiceBundle: number | null;
};

/**
 * HQ build days are the person-hours spread across an 8-hour crew day.
 * Site days are the pricer's install duration. Both are held from the start date.
 */
export function jobSpanDays(siteDays: number, hqPersonHours: number, crew: number) {
  const site = Math.max(1, Math.trunc(siteDays) || 1);
  const people = Math.max(1, Math.trunc(crew) || 1);
  const hq = hqPersonHours > 0 ? Math.max(1, Math.ceil(hqPersonHours / (people * 8))) : 0;
  return { siteDays: site, hqDays: hq, totalDays: site + hq };
}

export function availableStartDates(input: {
  from: string;
  to: string;
  totalDays: number;
  requirements: JobRequirements;
  resources: PoolResource[];
  busyByDay: Readonly<Record<string, readonly string[]>>;
  allowWeekends: boolean;
  /** Present so a caller can see that flags are not a booking gate. */
  flags?: readonly unknown[];
}): string[] {
  const dates: string[] = [];
  let cursor = input.from;
  const guardLimit = 400;
  let guard = 0;
  // Saturday and Sunday are never a start date. An owner override can come later.
  void input.allowWeekends;
  while (cursor <= input.to && guard < guardLimit) {
    if (!isWeekend(cursor)) {
      const plan = planRange(
        input.requirements,
        input.resources,
        input.busyByDay,
        cursor,
        input.totalDays,
        false,
      );
      if (plan.selectable && plan.chosenIds.length > 0) dates.push(cursor);
    }
    cursor = addIsoDays(cursor, 1);
    guard += 1;
  }
  return dates;
}

/** Drops Saturday and Sunday. Used by the booking date list for every role. */
export function dropWeekendStarts(days: readonly string[]) {
  return days.filter((day) => !isWeekend(day));
}

export function reservationKeys(resourceIds: readonly string[], days: readonly string[]) {
  return days.flatMap((day) => resourceIds.map((id) => `${id}|${day}`));
}

export function claimReservation(store: Set<string>, keys: readonly string[]) {
  for (const key of keys) {
    if (store.has(key)) {
      return { ok: false as const, message: "Those engineers or vans are no longer free. Choose another start date." };
    }
  }
  for (const key of keys) store.add(key);
  return { ok: true as const };
}

/** One booking at a time, matching the database lock around the unique resource/day constraint. */
export function createReservationGate() {
  let chain: Promise<void> = Promise.resolve();
  return async function gate<T>(run: () => T): Promise<T> {
    const previous = chain;
    let release: () => void = () => undefined;
    chain = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return run();
    } finally {
      release();
    }
  };
}

export function warrantyPrice(choice: WarrantyChoice, prices: WarrantyPrices | null) {
  if (choice === "none") return null;
  if (!prices) throw new Error("No warranty was priced for this order.");
  const value =
    choice === "annual"
      ? prices.annual
      : choice === "twice_yearly"
        ? prices.twice
        : choice === "extension"
          ? prices.extension
          : choice === "annual_bundle"
            ? prices.annualBundle
            : prices.twiceBundle;
  if (value == null) throw new Error("That warranty option was not priced.");
  return value;
}

export function projectInstall(record: InstallRecord, view: "sales" | "ops") {
  const fields = view === "ops" ? OPS_INSTALL_FIELDS : SALES_INSTALL_FIELDS;
  const projected: InstallRecord = {};
  for (const field of fields) projected[field] = record[field] ?? null;
  return projected;
}
