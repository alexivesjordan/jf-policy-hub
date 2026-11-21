import { fromOcdsRelease, uniqueReleases, assessCandidate, type RadarCandidate } from "./domain";

const FTS_HOST = "www.find-tender.service.gov.uk";

function safeFeedUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== FTS_HOST ||
      !url.pathname.startsWith("/api/")) {
    throw new Error("The configured Find a Tender feed URL is not a permitted official API endpoint.");
  }
  return url.toString();
}

export type RadarBatch = {
  candidates: RadarCandidate[];
  unrecognisedReleases: number;
  fetchedAt: string;
  readCount: number;
};

/**
 * Fetch only a small bounded public OCDS release package.
 * The API endpoint is deployment configuration, NOT user-controlled.
 * This first slice intentionally does not crawl or follow arbitrary links.
 */
export async function fetchTenderBatch(rawUrl: string, fetchImpl: typeof fetch = fetch): Promise<RadarBatch> {
  const url = safeFeedUrl(rawUrl);
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "error",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(25_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Public tender feed returned HTTP " + response.status);
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("json")) throw new Error("Public tender feed did not return JSON.");
  const data = await response.text();
  if (data.length > 5_000_000) throw new Error("Feed response exceeds the bounded ingestion size.");
  const root = JSON.parse(data) as unknown;
  if (!root || typeof root !== "object" || Array.isArray(root)) throw new Error("Invalid OCDS release package.");
  const releases = (root as { releases?: unknown }).releases;
  if (!Array.isArray(releases)) throw new Error("OCDS release package does not contain releases.");
  if (releases.length > 1000) throw new Error("Feed contains more than 1000 releases; use paginated ingestion.");
  const parsed = releases.map(fromOcdsRelease).filter((c): c is RadarCandidate => c !== null);
  return {
    candidates: uniqueReleases(parsed),
    unrecognisedReleases: releases.length - parsed.length,
    readCount: releases.length,
    fetchedAt: new Date().toISOString(),
  };
}

export function radarPreview(batch: RadarBatch, now = new Date()) {
  return batch.candidates.map(candidate => ({
    candidate,
    assessment: assessCandidate(candidate, now),
  })).sort((a,b)=>b.assessment.score-a.assessment.score);
}
