import type { VisitDraft } from "@/lib/service/model";

/** Calendar months, clamped to the last day of the target month. Matches Postgres date + interval. */
export function addMonths(isoDate: string, months: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match || !Number.isInteger(months)) return isoDate;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const target = monthIndex + months;
  const nextYear = year + Math.floor(target / 12);
  const nextMonth = ((target % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
  const nextDay = Math.min(day, lastDay);
  const month = String(nextMonth + 1).padStart(2, "0");
  const date = String(nextDay).padStart(2, "0");
  return `${nextYear}-${month}-${date}`;
}

export function cadenceMonths(warranty: string | null | undefined) {
  if (warranty === "twice_yearly" || warranty === "twice_yearly_bundle") return 6;
  if (warranty === "annual" || warranty === "annual_bundle") return 12;
  return null;
}

export function cadenceLabel(months: number) {
  if (months === 6) return "Every 6 months";
  if (months === 12) return "Every 12 months";
  return `${months} months`;
}

export type PlanSeed = {
  id: string;
  customerName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postcode: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  nextDueOn: string;
};

/** Null keeps New visit blank. A plan only prefills when one was opened on purpose. */
export function planVisitSeed(plan: PlanSeed | null): Partial<VisitDraft> | null {
  if (!plan) return null;
  return {
    customerName: plan.customerName,
    addressLine1: plan.addressLine1,
    addressLine2: plan.addressLine2,
    city: plan.city,
    postcode: plan.postcode,
    contactName: plan.contactName,
    contactPhone: plan.contactPhone,
    contactEmail: plan.contactEmail,
    visitType: "service",
    visitOn: plan.nextDueOn,
    durationMinutes: "60",
    maintenancePlanId: plan.id,
    notes: "",
    cin7OrderNumber: "",
    hubspotTicket: "",
    windowStart: "",
    windowEnd: "",
    assigneeIds: [],
  };
}
