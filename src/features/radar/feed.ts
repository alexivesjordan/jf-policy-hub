import { fromOcdsRelease } from "@/features/radar/parse";
import type { ParsedNotice, RadarSource } from "@/features/radar/types";

const SEARCH: Record<RadarSource, { host: string; path: string }> = {
  "find-a-tender": { host: "www.find-tender.service.gov.uk", path: "/api/1.0/ocdsReleasePackages" },
  "contracts-finder": { host: "www.contractsfinder.service.gov.uk", path: "/Published/Notices/OCDS/Search" },
};

export const RADAR_PAGE_LIMIT = 100;
export const RADAR_MAX_PAGES = 3;

export function assertOfficialFeedUrl(source: RadarSource, raw: string) {
  const url = new URL(raw);
  const allowed = SEARCH[source];
  if (url.protocol !== "https:" || url.username || url.password || url.hostname !== allowed.host || url.pathname !== allowed.path) {
    throw new Error("The tender feed URL is not a permitted official endpoint.");
  }
  return url.toString();
}

export function feedUrl(source: RadarSource, from: string) {
  const base = SEARCH[source];
  const url = new URL(`https://${base.host}${base.path}`);
  url.searchParams.set("limit", String(RADAR_PAGE_LIMIT));
  url.searchParams.set("stages", "tender");
  if (source === "find-a-tender") url.searchParams.set("updatedFrom", from);
  else url.searchParams.set("publishedFrom", from);
  return assertOfficialFeedUrl(source, url.toString());
}

export function ingestWindow(now: Date, lookbackDays: number) {
  const days = Math.min(14, Math.max(1, Math.floor(lookbackDays) || 2));
  const from = new Date(now.getTime() - days * 86_400_000);
  return {
    days,
    ftsFrom: from.toISOString().slice(0, 19),
    cfFrom: from.toISOString().slice(0, 10),
  };
}

function nextLink(source: RadarSource, root: unknown) {
  const links = root && typeof root === "object" && !Array.isArray(root) ? (root as { links?: { next?: unknown } }).links : null;
  if (!links || typeof links.next !== "string" || !links.next) return null;
  try {
    return assertOfficialFeedUrl(source, links.next);
  } catch {
    return null;
  }
}

export async function fetchReleasePages(source: RadarSource, startUrl: string, fetchImpl: typeof fetch = fetch) {
  const releases: unknown[] = [];
  const seen = new Set<string>();
  let url: string | null = assertOfficialFeedUrl(source, startUrl);
  let pages = 0;
  let truncated = false;
  while (url && pages < RADAR_MAX_PAGES) {
    if (seen.has(url)) break;
    seen.add(url);
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      headers: { Accept: "application/json", "User-Agent": "JordanPulseRadar/1.0" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Public tender feed returned HTTP ${response.status}`);
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("json")) throw new Error("Public tender feed did not return JSON.");
    const text = await response.text();
    if (text.length > 5_000_000) throw new Error("Feed response exceeds the bounded ingestion size.");
    const root = JSON.parse(text) as unknown;
    if (!root || typeof root !== "object" || Array.isArray(root) || !Array.isArray((root as { releases?: unknown }).releases)) {
      throw new Error("OCDS release package does not contain releases.");
    }
    releases.push(...(root as { releases: unknown[] }).releases);
    pages += 1;
    const next = nextLink(source, root);
    if (next && pages >= RADAR_MAX_PAGES) truncated = true;
    url = pages >= RADAR_MAX_PAGES ? null : next;
  }
  return { releases, pages, truncated };
}

export function parseReleases(source: RadarSource, releases: unknown[]) {
  const notices: ParsedNotice[] = [];
  let unrecognised = 0;
  for (const release of releases) {
    const notice = fromOcdsRelease(source, release);
    if (!notice) {
      unrecognised += 1;
      continue;
    }
    notices.push(notice);
  }
  return { notices, unrecognised };
}
