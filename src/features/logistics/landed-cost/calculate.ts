import { adValoremPercent, evaluateDutyPence, isSimpleDuty, type ParsedDuty } from "@/features/logistics/landed-cost/duty";
import { toGbpPence } from "@/features/logistics/landed-cost/money";

export const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"] as const;
export type Incoterm = (typeof INCOTERMS)[number];

export type ChargeLine = {
  label: string;
  duty: ParsedDuty;
  residual: boolean;
};

export type LandedCostInput = {
  incoterm: Incoterm;
  goodsValue: number;
  freight: number;
  insurance: number;
  otherCharges: number;
  afterBorder: number;
  unitsPerGbp: number;
  quantity: number | null;
  netWeightKg: number | null;
  customsDuty: ParsedDuty;
  additional: ChargeLine[];
  vatPercent: number;
};

export type LandedCostResult = {
  customsValuePence: number;
  dutyPence: number;
  additional: { label: string; pence: number; percent: number; residual: boolean }[];
  additionalPence: number;
  otherChargesPence: number;
  vatPence: number;
  vatPercent: number;
  landedPence: number;
  perUnitPence: number | null;
  dutyPercent: number;
};

/**
 * UK valuation. Duty is charged on the CIF customs value.
 * VAT is charged on CIF + duty + other charges.
 * DAP, DPU and DDP prices include arrival, so freight and insurance are not added again.
 * DDP also includes duty and VAT, which are removed before duty is charged.
 */
export function customsForeign(input: Pick<LandedCostInput, "incoterm" | "goodsValue" | "freight" | "insurance" | "afterBorder">) {
  const goods = input.goodsValue;
  const freight = input.freight;
  const insurance = input.insurance;
  const afterBorder = input.afterBorder;
  switch (input.incoterm) {
    case "EXW":
    case "FCA":
    case "FAS":
    case "FOB":
      return { amount: goods + freight + insurance, dutyPaid: false };
    case "CFR":
    case "CPT":
      return { amount: goods + insurance, dutyPaid: false };
    case "CIF":
    case "CIP":
      return { amount: goods, dutyPaid: false };
    case "DAP":
    case "DPU":
      return { amount: goods - afterBorder, dutyPaid: false };
    case "DDP":
      return { amount: goods - afterBorder, dutyPaid: true };
  }
}

function assertMoney(input: LandedCostInput) {
  for (const amount of [input.goodsValue, input.freight, input.insurance, input.otherCharges, input.afterBorder]) {
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Amount must be zero or more.");
  }
  if (!Number.isFinite(input.vatPercent) || input.vatPercent < 0) throw new Error("VAT rate is missing.");
  if (input.quantity != null && (!(input.quantity > 0) || !Number.isFinite(input.quantity))) throw new Error("Quantity must be above zero.");
  if (input.netWeightKg != null && (!(input.netWeightKg >= 0) || !Number.isFinite(input.netWeightKg))) throw new Error("Net weight must be zero or more.");
}

function specificPence(duty: ParsedDuty, quantity: number | null, netWeightKg: number | null) {
  return evaluateDutyPence(duty, { customsValuePence: 0, quantity, netWeightKg });
}

export function calculateLandedCost(input: LandedCostInput): LandedCostResult {
  assertMoney(input);
  const foreign = customsForeign(input);
  if (foreign.amount < 0) throw new Error("After border is higher than the goods value.");
  const otherChargesPence = toGbpPence(input.otherCharges, input.unitsPerGbp);
  const context = { quantity: input.quantity, netWeightKg: input.netWeightKg };

  let customsValuePence: number;
  if (!foreign.dutyPaid) {
    customsValuePence = toGbpPence(foreign.amount, input.unitsPerGbp);
  } else {
    const duties = [input.customsDuty, ...input.additional.map((line) => line.duty)];
    if (duties.some((duty) => !isSimpleDuty(duty))) throw new Error("This duty cannot be taken out of a DDP price.");
    const dutyFraction = duties.reduce((total, duty) => total + adValoremPercent(duty), 0) / 100;
    const vatFraction = input.vatPercent / 100;
    const specific = duties.reduce((total, duty) => total + specificPence(duty, input.quantity, input.netWeightKg), 0);
    const paidPence = toGbpPence(foreign.amount, input.unitsPerGbp);
    const beforeVat = paidPence / (1 + vatFraction);
    customsValuePence = Math.round((beforeVat - specific - otherChargesPence) / (1 + dutyFraction));
    if (customsValuePence < 0) throw new Error("The DDP price is below the duty and VAT in it.");
  }

  const dutyPence = evaluateDutyPence(input.customsDuty, { ...context, customsValuePence });
  const additional = input.additional.map((line) => ({
    label: line.label,
    percent: adValoremPercent(line.duty),
    residual: line.residual,
    pence: evaluateDutyPence(line.duty, { ...context, customsValuePence }),
  }));
  const additionalPence = additional.reduce((total, line) => total + line.pence, 0);
  const vatBase = customsValuePence + dutyPence + additionalPence + otherChargesPence;
  const vatPence = Math.round((vatBase * input.vatPercent) / 100);
  const landedPence = vatBase + vatPence;
  return {
    customsValuePence,
    dutyPence,
    additional,
    additionalPence,
    otherChargesPence,
    vatPence,
    vatPercent: input.vatPercent,
    landedPence,
    perUnitPence: input.quantity ? Math.round(landedPence / input.quantity) : null,
    dutyPercent: adValoremPercent(input.customsDuty),
  };
}
