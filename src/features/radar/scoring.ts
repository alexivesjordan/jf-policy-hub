import type { RadarScoringConfig, ScoreResult, ValueBand } from "@/features/radar/types";

const KEYWORD_EACH = 22;
const KEYWORD_CAP = 66;
const CPV_POINTS = 28;
const BAND_CAP = 20;

export type ScoreInput = {
  title: string;
  description: string;
  buyer: string;
  cpvCodes: string[];
  valueAmount: number | null;
  decisionStatus?: string | null;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function keywordHits(text: string, keywords: string[]) {
  const hay = text.toLowerCase();
  const hits: string[] = [];
  const seen = new Set<string>();
  for (const keyword of keywords) {
    const needle = keyword.trim().toLowerCase();
    if (needle.length < 2 || seen.has(needle)) continue;
    const matched = needle.includes(" ")
      ? hay.includes(needle)
      : new RegExp(`\\b${escapeRegExp(needle)}\\b`, "i").test(hay);
    if (!matched) continue;
    seen.add(needle);
    hits.push(needle);
  }
  return hits;
}

export function matchingCpv(codes: string[], configured: string[]) {
  for (const code of codes) {
    const left = code.replace(/\D/g, "");
    if (left.length < 2) continue;
    for (const wanted of configured) {
      const right = wanted.replace(/\D/g, "");
      if (right.length < 2) continue;
      if (left.startsWith(right) || right.startsWith(left)) return right;
    }
  }
  return null;
}

export function matchingBand(amount: number | null, bands: ValueBand[]) {
  if (amount == null || !Number.isFinite(amount)) return null;
  let best: ValueBand | null = null;
  for (const band of bands) {
    const min = band.min ?? 0;
    if (amount < min) continue;
    if (band.max != null && amount >= band.max) continue;
    if (!best || band.points > best.points) best = band;
  }
  return best;
}

function equipmentBearing(keyword: string) {
  return /equipment|treadmill|weights|cardio|machine|suite/.test(keyword);
}

export function scoreOpportunity(input: ScoreInput, config: RadarScoringConfig): ScoreResult {
  const text = `${input.title}\n${input.description}\n${input.buyer}`.slice(0, 20_000);
  const hits = keywordHits(text, config.keywords);
  const cpv = matchingCpv(input.cpvCodes, config.cpvCodes);
  const excluded = keywordHits(text, config.exclusions);
  const equipment = hits.some(equipmentBearing) || Boolean(cpv);
  const knockedOut = excluded.length > 0 && !equipment;
  const relevant = (hits.length > 0 || Boolean(cpv)) && !knockedOut;
  const band = relevant ? matchingBand(input.valueAmount, config.valueBands) : null;
  const granted = input.decisionStatus === "Permitted" || input.decisionStatus === "Conditions";
  const reasons: string[] = [];
  if (knockedOut) {
    reasons.push(`Excluded: ${excluded[0]}`);
  } else {
    for (const hit of hits.slice(0, 6)) reasons.push(`Keyword: ${hit}`);
    if (cpv) reasons.push(`CPV ${cpv}`);
    if (band) reasons.push(`Value in ${band.label}`);
    if (relevant && granted && input.decisionStatus) reasons.push(`Decision: ${input.decisionStatus}`);
  }
  const score = knockedOut
    ? 0
    : Math.max(
        0,
        Math.min(
          100,
          Math.min(KEYWORD_CAP, hits.length * KEYWORD_EACH) +
            (cpv ? CPV_POINTS : 0) +
            Math.min(BAND_CAP, band?.points ?? 0) +
            (relevant && granted ? 8 : 0),
        ),
      );
  return { score, relevant, reasons };
}
