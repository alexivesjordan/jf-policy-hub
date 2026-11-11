import { quoteFlag, type QuoteFlag } from "@/lib/quotes/flags";
import {
  DEFAULT_SERVICE_RATES,
  defaultPmUnits,
  defaultWarrantyRate,
  isServiceCategory,
  type ServiceCategory,
  type ServiceRates,
} from "./rates";

export type ServiceLineInput = {
  sku?: string | null;
  description: string;
  quantity: number;
  lineNet: number;
  category: string;
  reviewNote?: string | null;
  pmUnitsPerItem?: number;
  warrantyRate?: number;
};

export type ServiceSiteInput = {
  name?: string | null;
  address?: string | null;
  lineItems: ServiceLineInput[];
};

export type ServiceQuoteInput = {
  customer: string;
  quoteNumber?: string | null;
  quoteDate?: string | null;
  currency?: string | null;
  goodsNet?: number | null;
  sourceDocument?: string | null;
  sourceNotes?: string | null;
  sites: ServiceSiteInput[];
  additionalCharges?: { description: string; amountNet: number }[];
};

export type ServiceSitePrices = {
  pmUnits: number;
  warrantyBaseRisk: number;
  annualPm: number;
  twiceYearlyPm: number;
  extendedWarrantyOneOff: number;
  annualBundleYear1: number | null;
  twiceBundleYear1: number | null;
  bundleIncentive: number;
  hasPmScope: boolean;
  hasWarrantyScope: boolean;
};

const MANUAL_REVIEW: Partial<Record<ServiceCategory, string>> = {
  unresolved_dhz:
    "Identity and actual number of machines unconfirmed. Provisional DHZ service/warranty allowance only; no component cover promised.",
  unknown_product: "Product identity cannot be established from the quote. Excluded from auto-price; may require a revised proposal.",
  jordan_cardio_unverified: "Cardio OEM/model and covered components require confirmation before warranty issue.",
  other_cardio_unverified: "Third-party/unclear cardio: PM priced, warranty extension excluded pending written approval.",
  cable_or_power_rack: "Rack/functional trainer parts eligibility and OEM require confirmation; provisional pricing assumption.",
};

function roundHalfUpToInt(value: number): number {
  return Math.sign(value) * Math.floor(Math.abs(value) + 0.5);
}

function round2(value: number): number {
  return roundHalfUpToInt(value * 100) / 100;
}

/** commercial95(v, step) = step × round_half_up((v + 5) / step) − 5, minimum £95. */
export function commercial95(value: number, step: number): number {
  const units = roundHalfUpToInt((value + 5) / step);
  return Math.max(95, units * step - 5);
}

export function nearestFive(value: number): number {
  return roundHalfUpToInt(value / 5) * 5;
}

export function sitePrice(pmUnits: number, risk: number, rates: ServiceRates = DEFAULT_SERVICE_RATES): ServiceSitePrices {
  let annual = 0;
  let twice = 0;
  if (pmUnits > 0) {
    const raw = (rates.callout + rates.perMachine * pmUnits) * rates.uplift;
    annual = commercial95(raw, 100);
    twice = commercial95(2 * annual * rates.twiceYearlyFactor, 50);
  }
  const extension = risk > 0 ? commercial95(risk * rates.extensionFactor + rates.perSite, 100) : 0;
  const discount = annual > 0 && extension > 0 ? rates.bundleIncentive : 0;
  return {
    pmUnits,
    warrantyBaseRisk: round2(risk),
    annualPm: annual,
    twiceYearlyPm: twice,
    extendedWarrantyOneOff: extension,
    annualBundleYear1: discount ? round2(Math.max(0, annual + extension - discount)) : null,
    twiceBundleYear1: discount ? round2(Math.max(0, twice + extension - discount)) : null,
    bundleIncentive: discount,
    hasPmScope: pmUnits > 0,
    hasWarrantyScope: risk > 0,
  };
}

function clean(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

export type ServiceQuoteResult = {
  rateCardVersion: string;
  status: string;
  customer: string;
  quoteNumber: string;
  quoteDate: string;
  sourceDocument: string;
  sourceNotes: string;
  currency: "GBP";
  goodsNetSource: number | null;
  goodsNetFromLines: number;
  goodsNetDiscrepancy: number | null;
  additionalCharges: { description: string; amountNet: number }[];
  sites: {
    name: string;
    address: string;
    goodsNet: number;
    lineItems: {
      sku: string;
      description: string;
      quantity: number;
      lineNet: number;
      category: ServiceCategory;
      pmUnits: number;
      warrantyRate: number;
      warrantyRiskContribution: number;
      provisional: boolean;
      reviewNote: string;
    }[];
    prices: ServiceSitePrices;
    knownOnlySensitivity: ServiceSitePrices;
    flags: QuoteFlag[];
  }[];
  flags: QuoteFlag[];
  portfolioPm: { annualPmAllSites: number; twiceYearlyPmAllSites: number; conditions: string } | null;
  assumptions: string[];
};

export function calculateServiceQuote(input: ServiceQuoteInput, rates: ServiceRates = DEFAULT_SERVICE_RATES): ServiceQuoteResult {
  const customer = clean(input.customer);
  if (!customer) throw new Error("Missing customer");
  const currency = clean(input.currency || "GBP").toUpperCase();
  if (currency !== "GBP") throw new Error(`Rate card is GBP only, received ${JSON.stringify(currency)}; do not silently mislabel currencies`);
  if (!Array.isArray(input.sites) || input.sites.length === 0) throw new Error("sites must be a non-empty list");

  const result: ServiceQuoteResult = {
    rateCardVersion: rates.version,
    status: "PROVISIONAL",
    customer,
    quoteNumber: clean(input.quoteNumber) || "Not provided",
    quoteDate: clean(input.quoteDate) || "Not provided",
    sourceDocument: clean(input.sourceDocument) || "Provided quotation/order",
    sourceNotes: clean(input.sourceNotes),
    currency: "GBP",
    goodsNetSource: input.goodsNet == null ? null : round2(input.goodsNet),
    goodsNetFromLines: 0,
    goodsNetDiscrepancy: null,
    additionalCharges: input.additionalCharges ?? [],
    sites: [],
    flags: [],
    portfolioPm: null,
    assumptions: [
      "All prices exclude VAT. Installation, delivery and recycling are not in the warranty eligible value.",
      "Prices assume a planned weekday visit and normal access. Travel has not been checked.",
      "The five-year extension is eligible parts only, measured from delivery, not five extra years.",
      "These rates are the November 2026 baseline stored in Jordan Pulse. They are not a cost-to-us model.",
    ],
  };

  let totalGoods = 0;
  input.sites.forEach((site, siteIndex) => {
    if (!site || !Array.isArray(site.lineItems) || site.lineItems.length === 0) {
      throw new Error(`site ${siteIndex + 1} must have nonempty line_items`);
    }
    const name = clean(site.name) || `Site ${siteIndex + 1}`;
    const address = clean(site.address) || "Not specified in quote";
    let units = 0;
    let risk = 0;
    let siteGoods = 0;
    let knownUnits = 0;
    let knownRisk = 0;
    const flags: QuoteFlag[] = [];
    const lines = site.lineItems.map((line, lineIndex) => {
      const category = clean(line.category);
      if (!isServiceCategory(category)) throw new Error(`${name}: line ${lineIndex + 1} bad or missing category ${JSON.stringify(category)}`);
      const description = clean(line.description);
      if (!description) throw new Error(`${name}: line ${lineIndex + 1} missing description`);
      const qty = Number(line.quantity);
      const lineNet = round2(line.lineNet ?? 0);
      if (!(qty > 0) || lineNet < 0) throw new Error(`${name}: line ${lineIndex + 1} quantity must be >0 and line_net >=0`);
      const pmItem = line.pmUnitsPerItem ?? defaultPmUnits(category);
      const rate = line.warrantyRate ?? defaultWarrantyRate(category, rates);
      if (pmItem < 0 || rate < 0 || rate > 1) throw new Error(`${name}: line ${lineIndex + 1} invalid override`);
      const riskValue = round2(lineNet * rate);
      const counted = qty * pmItem;
      if (category === "delivery_install") {
        if (riskValue || counted) throw new Error("Delivery/install must not carry PM units or warranty risk");
      } else {
        units += counted;
        risk += riskValue;
        siteGoods += lineNet;
        if (category !== "unresolved_dhz") {
          knownUnits += counted;
          knownRisk += riskValue;
        }
      }
      const note = clean(line.reviewNote);
      const review = MANUAL_REVIEW[category];
      if (review) {
        flags.push(quoteFlag("manual_review", `${name} | ${clean(line.sku) || `line ${lineIndex + 1}`}: ${review}${note ? ` ${note}` : ""}`));
      } else if ((line.pmUnitsPerItem != null || line.warrantyRate != null) && !note) {
        flags.push(quoteFlag("manual_override", `${name} | ${description}: manual rate/category override requires documentary approval note.`));
      }
      return {
        sku: clean(line.sku),
        description,
        quantity: qty,
        lineNet,
        category,
        pmUnits: category === "delivery_install" ? 0 : counted,
        warrantyRate: rate,
        warrantyRiskContribution: category === "delivery_install" ? 0 : riskValue,
        provisional: category === "unresolved_dhz",
        reviewNote: note,
      };
    });
    siteGoods = round2(siteGoods);
    totalGoods += siteGoods;
    const prices = sitePrice(units, round2(risk), rates);
    const knownOnlySensitivity = sitePrice(knownUnits, round2(knownRisk), rates);
    if (units <= 0) flags.push(quoteFlag("no_pm_scope", `${name}: zero identified serviceable units; PM price cannot be quoted automatically`));
    if (risk <= 0) flags.push(quoteFlag("no_warranty_scope", `${name}: no eligible/provisionally eligible component value; extension cannot be quoted automatically`));
    result.sites.push({ name, address, goodsNet: siteGoods, lineItems: lines, prices, knownOnlySensitivity, flags });
    result.flags.push(...flags);
  });

  result.goodsNetFromLines = round2(totalGoods);
  if (input.goodsNet != null) {
    const recorded = round2(input.goodsNet);
    const delta = round2(totalGoods - recorded);
    result.goodsNetDiscrepancy = delta;
    if (Math.abs(delta) > 0.1) {
      result.flags.push(
        quoteFlag(
          "goods_net_discrepancy",
          `Goods net reconciliation: quoted £${recorded}; product lines £${totalGoods}; difference £${Math.abs(delta)}.`,
          delta,
        ),
      );
    }
  } else {
    result.flags.push(quoteFlag("goods_net_missing", "Goods net was not provided, so the product lines could not be checked against it."));
    result.goodsNetDiscrepancy = null;
  }

  if (result.sites.length >= 2 && result.sites.every((site) => site.prices.hasPmScope)) {
    const annual = result.sites.reduce((sum, site) => sum + site.prices.annualPm, 0);
    const twice = result.sites.reduce((sum, site) => sum + site.prices.twiceYearlyPm, 0);
    result.portfolioPm = {
      annualPmAllSites: nearestFive(annual * rates.portfolioFactor),
      twiceYearlyPmAllSites: nearestFive(twice * rates.portfolioFactor),
      conditions: "10% PM discount only when all listed sites select the same agreed programme. No automatic extended-warranty or further bundle discount.",
    };
  }
  if (result.sites.length >= 2) {
    result.flags.push(quoteFlag("multi_site_approval", "Bundle and portfolio discount needs management approval."));
  }
  return result;
}

export function customerProposalText(result: ServiceQuoteResult): string {
  const lines = [
    "PROVISIONAL",
    "Warranty & Preventative Maintenance Options",
    `Prepared for: ${result.customer}`,
    `Source quotation/order: ${result.quoteNumber}`,
  ];
  for (const site of result.sites) {
    lines.push(site.name, String(site.prices.annualPm), String(site.prices.extendedWarrantyOneOff));
  }
  return lines.join("\n");
}
