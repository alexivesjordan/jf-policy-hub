import { calculateLandedCost, INCOTERMS, type Incoterm } from "@/features/logistics/landed-cost/calculate";
import { isIsoDate, monthOf } from "@/features/logistics/landed-cost/money";
import { matchManualRate, type ManualRate } from "@/features/logistics/landed-cost/manual-rates";
import { type ParsedDuty } from "@/features/logistics/landed-cost/duty";
import { parseHmrcCsv } from "@/features/logistics/landed-cost/exchange";
import { EU_MEMBERS, parseTaricDetails, type TaricDuty } from "@/features/logistics/landed-cost/taric";
import { dutyLabel, parseCommodity } from "@/features/logistics/landed-cost/uk-tariff";
import { countryChoices, normaliseHsCode } from "@/features/logistics/commercial-invoice/rules";

const COUNTRIES = new Set(countryChoices().map((country) => country.code));

export type QuoteRequest = {
  destination: string;
  origin: string;
  commodityCode: string;
  incoterm: string;
  goodsValue: number;
  freight: number;
  insurance: number;
  otherCharges: number;
  afterBorder: number;
  currency: string;
  /** Set only when the user replaces the HMRC rate. */
  rateOverride: number | null;
  asOf: string;
  quantity: number | null;
  netWeightKg: number | null;
  claimPreference: boolean;
};

export type QuoteDeps = {
  ukCommodity: (code: string, asOf: string) => Promise<{ payload: unknown; stale: boolean }>;
  hmrcMonth: (month: string) => Promise<{ csv: string; stale: boolean }>;
  taricHtml: (code: string, origin: string, asOf: string) => Promise<{ html: string; stale: boolean } | null>;
  manualRates: () => Promise<ManualRate[]>;
};

export type QuoteView = {
  estimate: boolean;
  stale: boolean;
  rateSource: "hmrc" | "manual" | "gbp";
  unitsPerGbp: number;
  ratePeriod: string | null;
  dutySource: "UK Trade Tariff" | "EU TARIC" | "Stored rate";
  description: string;
  commodityCode: string;
  origin: string;
  destination: string;
  incoterm: Incoterm;
  customsValuePence: number;
  dutyPence: number;
  dutyPercent: number;
  dutyLabel: string;
  rulesOfOrigin: boolean;
  thirdCountryPercent: number | null;
  preferenceAvailable: boolean;
  additional: { label: string; pence: number; percent: number; residual: boolean }[];
  vatPence: number;
  vatPercent: number;
  otherChargesPence: number;
  landedPence: number;
  perUnitPence: number | null;
  quantity: number | null;
  quotaAvailable: boolean;
  exporterSpecific: boolean;
};

function country(value: string, label: string) {
  const code = value.trim().toUpperCase();
  if (!COUNTRIES.has(code)) throw new Error(`Enter a ${label}.`);
  return code;
}

function money(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000_000) throw new Error("Amount must be zero or more.");
  return value;
}

function percentDuty(percent: number): ParsedDuty {
  return { pieces: [{ op: "add", kind: "percent", percent }] };
}

export async function buildQuote(request: QuoteRequest, deps: QuoteDeps): Promise<QuoteView> {
  const destination = country(request.destination, "destination");
  const origin = country(request.origin, "origin");
  if (destination === "GB" && origin === "GB") throw new Error("Origin and destination are both the UK.");
  const commodityCode = normaliseHsCode(request.commodityCode);
  if (!commodityCode) throw new Error("Commodity code requires 6-10 digits.");
  if (!INCOTERMS.includes(request.incoterm as Incoterm)) throw new Error("Enter an incoterm.");
  if (!isIsoDate(request.asOf)) throw new Error("Enter a valid date.");
  const currency = request.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Enter a currency.");
  const quantity = request.quantity;
  if (quantity != null && (!(quantity > 0) || !Number.isFinite(quantity))) throw new Error("Quantity must be above zero.");
  const netWeightKg = request.netWeightKg;
  if (netWeightKg != null && (!(netWeightKg >= 0) || !Number.isFinite(netWeightKg))) throw new Error("Net weight must be zero or more.");

  const rate = await resolveRate(currency, request.rateOverride, request.asOf, deps);
  const base = {
    incoterm: request.incoterm as Incoterm,
    goodsValue: money(request.goodsValue),
    freight: money(request.freight),
    insurance: money(request.insurance),
    otherCharges: money(request.otherCharges),
    afterBorder: money(request.afterBorder),
    unitsPerGbp: rate.unitsPerGbp,
    quantity,
    netWeightKg,
  };

  if (destination === "GB") {
    const loaded = await deps.ukCommodity(commodityCode, request.asOf);
    let tariff;
    try {
      tariff = parseCommodity(loaded.payload, origin, request.asOf);
    } catch {
      throw new Error("The UK Trade Tariff returned an unreadable commodity.");
    }
    if (!tariff.declarable) throw new Error("This code is not a declarable commodity.");
    if (!tariff.thirdCountry) throw new Error("The UK Trade Tariff has no third country duty for this code.");
    if (tariff.vatPercent == null) throw new Error("The UK Trade Tariff has no import VAT for this code.");
    const preference = request.claimPreference ? tariff.preference : null;
    const customsDuty = preference?.duty ?? tariff.thirdCountry.duty;
    const result = calculateLandedCost({
      ...base,
      customsDuty,
      additional: tariff.additional.map((measure) => ({ label: dutyLabel(measure.measureType, measure.residual), duty: measure.duty, residual: measure.residual })),
      vatPercent: tariff.vatPercent,
    });
    return view(request, commodityCode, destination, origin, tariff.description, rate, result, {
      estimate: loaded.stale || rate.stale,
      stale: loaded.stale || rate.stale,
      dutySource: "UK Trade Tariff",
      dutyLabel: preference ? "Preferential · rules of origin" : "Duty",
      rulesOfOrigin: Boolean(preference),
      thirdCountryPercent: tariff.thirdCountry.percent,
      preferenceAvailable: Boolean(tariff.preference),
      quotaAvailable: tariff.quotaAvailable,
      exporterSpecific: tariff.exporterSpecific,
    });
  }

  const manual = matchManualRate(await deps.manualRates(), destination, origin, commodityCode);
  const taric = EU_MEMBERS.has(destination) ? await deps.taricHtml(commodityCode, origin, request.asOf).catch(() => null) : null;
  const parsed = taric ? parseTaricDetails(taric.html) : null;
  const official = parsed?.thirdCountryPercent != null ? parsed : null;
  if (!official && !manual) throw new Error("Add a duty and VAT rate for this destination.");
  if (official && !manual) throw new Error("Add a VAT rate for this destination.");
  const duty = official ? officialDuty(official, request.claimPreference) : { duty: percentDuty(manual!.dutyPercent), label: "Duty", rulesOfOrigin: false, thirdCountry: manual!.dutyPercent, preference: false };
  const vatPercent = manual?.vatPercent;
  if (vatPercent == null) throw new Error("Add a VAT rate for this destination.");
  const additional = official
    ? official.additional.map((line) => ({ label: line.label, duty: percentDuty(line.percent), residual: false }))
    : [];
  const result = calculateLandedCost({ ...base, customsDuty: duty.duty, additional, vatPercent });
  return view(request, commodityCode, destination, origin, "", rate, result, {
    estimate: true,
    stale: Boolean(taric?.stale),
    dutySource: official ? "EU TARIC" : "Stored rate",
    dutyLabel: duty.rulesOfOrigin ? "Preferential · rules of origin" : "Duty",
    rulesOfOrigin: duty.rulesOfOrigin,
    thirdCountryPercent: duty.thirdCountry,
    preferenceAvailable: duty.preference,
    quotaAvailable: false,
    exporterSpecific: false,
  });
}

function officialDuty(taric: TaricDuty, claimPreference: boolean) {
  const third = taric.thirdCountryPercent ?? 0;
  const preference = taric.preferencePercent != null && taric.preferencePercent <= third ? taric.preferencePercent : null;
  const usePreference = claimPreference && preference != null;
  return {
    duty: percentDuty(usePreference ? preference : third),
    label: usePreference ? "Preferential · rules of origin" : "Duty",
    rulesOfOrigin: usePreference,
    thirdCountry: third,
    preference: preference != null,
  };
}

async function resolveRate(currency: string, override: number | null, asOf: string, deps: QuoteDeps) {
  if (currency === "GBP") return { unitsPerGbp: 1, source: "gbp" as const, period: null, stale: false };
  if (override != null) {
    if (!Number.isFinite(override) || override <= 0) throw new Error("Enter an exchange rate.");
    return { unitsPerGbp: override, source: "manual" as const, period: null, stale: false };
  }
  let loaded;
  try {
    loaded = await deps.hmrcMonth(monthOf(asOf));
  } catch {
    throw new Error("HMRC exchange rates are unavailable.");
  }
  const rate = parseHmrcCsv(loaded.csv).get(currency);
  if (!rate) throw new Error("HMRC has no rate for that currency.");
  return { unitsPerGbp: rate.unitsPerGbp, source: "hmrc" as const, period: rate.start && rate.end ? `${rate.start} – ${rate.end}` : monthOf(asOf), stale: loaded.stale };
}

function view(
  request: QuoteRequest,
  commodityCode: string,
  destination: string,
  origin: string,
  description: string,
  rate: { unitsPerGbp: number; source: "hmrc" | "manual" | "gbp"; period: string | null; stale: boolean },
  result: ReturnType<typeof calculateLandedCost>,
  meta: {
    estimate: boolean;
    stale: boolean;
    dutySource: QuoteView["dutySource"];
    dutyLabel: string;
    rulesOfOrigin: boolean;
    thirdCountryPercent: number | null;
    preferenceAvailable: boolean;
    quotaAvailable: boolean;
    exporterSpecific: boolean;
  },
): QuoteView {
  return {
    estimate: meta.estimate,
    stale: meta.stale,
    rateSource: rate.source,
    unitsPerGbp: rate.unitsPerGbp,
    ratePeriod: rate.period,
    dutySource: meta.dutySource,
    description,
    commodityCode,
    origin,
    destination,
    incoterm: request.incoterm as Incoterm,
    customsValuePence: result.customsValuePence,
    dutyPence: result.dutyPence,
    dutyPercent: result.dutyPercent,
    dutyLabel: meta.dutyLabel,
    rulesOfOrigin: meta.rulesOfOrigin,
    thirdCountryPercent: meta.thirdCountryPercent,
    preferenceAvailable: meta.preferenceAvailable,
    additional: result.additional,
    vatPence: result.vatPence,
    vatPercent: result.vatPercent,
    otherChargesPence: result.otherChargesPence,
    landedPence: result.landedPence,
    perUnitPence: result.perUnitPence,
    quantity: request.quantity,
    quotaAvailable: meta.quotaAvailable,
    exporterSpecific: meta.exporterSpecific,
  };
}
