/**
 * Pulse Sales Opportunity Radar — deterministic screening of untrusted public data.
 * Scoring is a triage aid, not a valuation or a prediction of winning a tender.
 */
export type RadarCandidate = {
  source: "find-a-tender";
  releaseId: string;
  ocid: string;
  title: string;
  description: string;
  buyerName: string;
  publishedAt: string;
  deadlineAt: string | null;
  sourceUrl: string;
  cpvCodes: string[];
  valueAmount: number | null;
  valueCurrency: string | null;
  tags: string[];
};

export type RadarAssessment = {
  score: number;
  priority: "high" | "review" | "low";
  evidence: string[];
  warnings: string[];
  relevant: boolean;
  reviewedByHuman: false;
  classifiedAt: string;
};

const FITNESS = /\b(gym|gymnasium|fitness|exercise|strength|cardio|weightlifting|sport[s]?\s+(?:centre|center|facility|equipment)|leisure\s+(?:centre|center|facility)|physical\s+activity)\b/i;
const EQUIPMENT = /\b(equipment|supply|supplies|furnish|installation|fit[- ]?out|machines?|free\s+weights|treadmills?|rubber\s+flooring|procurement|refurbish|upgrade)\b/i;
const SERVICE = /\b(maintenance|servicing|inspection|repair|asset\s+replacement)\b/i;
const NON_EQUIPMENT = /\b(cleaning|catering|security\s+guard|building\s+design|architectural|legal\s+services|insurance\s+services|software\s+licens[ei]ng)\b/i;
const RELEVANT_CPV = new Set(["37440000", "37441000", "37442000", "37442100", "37442300", "37442900", "37420000"]);
const NON_EQUIPMENT_CPV = new Set(["90910000", "79710000", "71320000"]);
const trim = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const safeDate = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : null;
};

export function candidateKey(c: Pick<RadarCandidate, "source" | "releaseId">): string {
  return c.source + ":" + c.releaseId;
}

/** OCDS release ingestion: tolerate missing fields; reject untraceable releases. */
export function fromOcdsRelease(raw: unknown): RadarCandidate | null {
  const release = asRecord(raw);
  const releaseId = trim(release.id, 160);
  const ocid = trim(release.ocid, 160);
  const publishedAt = safeDate(release.date);
  if (!releaseId || !ocid || !publishedAt) return null;
  const tender = asRecord(release.tender);
  const buyer = asRecord(release.buyer);
  const value = asRecord(tender.value);
  const period = asRecord(tender.tenderPeriod);
  const mainClassification = asRecord(tender.mainProcurementCategory);
  const cpvs = [
    ...asArray(tender.items).flatMap(item => {
      const row = asRecord(item);
      return [asRecord(row.classification), ...asArray(row.additionalClassifications).map(asRecord)]
        .map(obj => trim(obj.id, 40)).filter(Boolean);
    }),
    ...[trim(mainClassification.id, 40)].filter(Boolean),
  ];
  const valueAmount = typeof value.amount === "number" && Number.isFinite(value.amount) && value.amount >= 0
    ? value.amount : null;
  return {
    source: "find-a-tender", releaseId, ocid, publishedAt,
    title: trim(tender.title, 300) || trim(release.title, 300) || "Untitled procurement",
    description: trim(tender.description, 12_000),
    buyerName: trim(buyer.name, 250) || "Not specified",
    deadlineAt: safeDate(period.endDate),
    sourceUrl: "https://www.find-tender.service.gov.uk/",
    cpvCodes: Array.from(new Set(cpvs)),
    valueAmount,
    valueCurrency: trim(value.currency, 3) || null,
    tags: asArray(release.tag).map(v => trim(v, 80)).filter(Boolean),
  };
}

/** Show the official notice URL only when a validated source exists. */
export function setNoticeLink(candidate: RadarCandidate, url: string): RadarCandidate {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "www.find-tender.service.gov.uk" || !parsed.pathname.startsWith("/Notice/"))
    return candidate;
  return { ...candidate, sourceUrl: parsed.toString() };
}

export function assessCandidate(candidate: RadarCandidate, now: Date = new Date()): RadarAssessment {
  const phrase = (candidate.title + "\n" + candidate.description).slice(0, 12_500);
  const fitness = FITNESS.test(phrase);
  const equipment = EQUIPMENT.test(phrase);
  const service = SERVICE.test(phrase);
  const relevantCpv = candidate.cpvCodes.some(code => RELEVANT_CPV.has(code));
  const irrelevantCpv = candidate.cpvCodes.some(code => NON_EQUIPMENT_CPV.has(code));
  const unrelated = NON_EQUIPMENT.test(phrase) && !equipment && !relevantCpv;
  const evidence: string[] = [];
  const warnings: string[] = [];
  let score = 0;
  if (fitness) { score += 40; evidence.push("Fitness or leisure use is explicitly mentioned."); }
  if (equipment) { score += 25; evidence.push("Equipment, installation or fit-out is mentioned."); }
  else if (service) { score += 12; evidence.push("A potential maintenance or servicing requirement is mentioned."); }
  if (relevantCpv) { score += 15; evidence.push("Relevant sporting-equipment classification identified."); }
  if (candidate.buyerName !== "Not specified") { score += 10; evidence.push("A named purchasing authority is available."); }
  if (candidate.valueAmount != null && candidate.valueAmount > 0) {
    score += 5; evidence.push("Published indicative procurement value is available.");
  }
  if (candidate.deadlineAt) {
    const days = (new Date(candidate.deadlineAt).getTime() - now.getTime()) / 86_400_000;
    if (days >= 7) score += 5;
    if (days < 0) warnings.push("The published tender deadline has passed.");
    else if (days < 7) warnings.push("Tender deadline is less than 7 days away.");
  } else warnings.push("Tender deadline is not available in this release.");
  if (unrelated || irrelevantCpv) {
    score = Math.min(score, 29);
    warnings.push("Possibly unrelated services procurement — needs manual review.");
  }
  if (candidate.tags.includes("award")) warnings.push("Published award notice; not necessarily open for bidding.");
  if (!fitness && !relevantCpv) warnings.push("Fitness-sector relevance is uncertain.");
  const relevant = (fitness || relevantCpv) && !unrelated;
  const bounded = Math.max(0, Math.min(100, score));
  return {
    score: bounded, relevant,
    priority: !relevant || bounded < 40 ? "low" : bounded >= 75 ? "high" : "review",
    evidence, warnings, reviewedByHuman: false, classifiedAt: now.toISOString(),
  };
}

/** Remove repeated releases from an ingestion batch without merging different notices in the same OCID. */
export function uniqueReleases(candidates: RadarCandidate[]): RadarCandidate[] {
  const byKey = new Map<string, RadarCandidate>();
  for (const c of candidates) {
    const key = candidateKey(c);
    if (!byKey.has(key) || byKey.get(key)!.publishedAt < c.publishedAt) byKey.set(key, c);
  }
  return Array.from(byKey.values());
}
