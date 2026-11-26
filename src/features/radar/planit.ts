import { estimatedValue, facilityTypes, publicPartyName, publishedEmail, publishedPhone, scopeSummary, ukPostcode } from "@/features/radar/extract";
import type { ParsedNotice } from "@/features/radar/types";

const SEARCH = "https://www.planit.org.uk/api/applics/json";
const MAX_PAGES = 2;
const PAGE_SIZE = 50;

export function planitSearchUrl(decidedFrom: string, page: number) {
  const url = new URL(SEARCH);
  url.searchParams.set(
    "search",
    'gym or "leisure centre" or "leisure center" or "sports hall" or "fitness suite" or "student accommodation" or pbsa or "care home"',
  );
  url.searchParams.set("app_state", "Permitted,Conditions");
  url.searchParams.set("decided_start", decidedFrom);
  url.searchParams.set("pg_sz", String(PAGE_SIZE));
  url.searchParams.set("page", String(page));
  url.searchParams.set("compress", "on");
  return assertPlanitUrl(url.toString());
}

export function assertPlanitUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.hostname !== "www.planit.org.uk" || url.pathname !== "/api/applics/json") {
    throw new Error("The planning feed URL is not a permitted PlanIt endpoint.");
  }
  return url.toString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function httpsUrl(value: unknown) {
  const raw = text(value, 500);
  if (!raw.startsWith("https://")) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function fromPlanitRecord(raw: unknown): ParsedNotice | null {
  const row = asRecord(raw);
  const noticeId = text(row.name, 180);
  if (!noticeId) return null;
  const other = asRecord(row.other_fields);
  const description = [text(other.application_type, 160), text(row.description, 4_000)].filter(Boolean).join(". ").slice(0, 4_000);
  const address = text(row.address, 300);
  const title = description.slice(0, 300) || noticeId;
  const applicant = publicPartyName(text(other.applicant_company, 200) || text(other.applicant_name, 200));
  const agent = publicPartyName(text(other.agent_company, 200) || text(other.agent_name, 200));
  const blob = `${description}\n${address}\n${text(other.agent_address, 300)}`;
  const value = estimatedValue(description);
  const url = httpsUrl(row.url) ?? httpsUrl(row.link) ?? `https://www.planit.org.uk/planapplic/${encodeURIComponent(noticeId)}/`;
  return {
    source: "planit",
    noticeId,
    ocid: null,
    title,
    description,
    buyer: applicant || text(row.area_name, 200) || "Not published",
    valueAmount: value,
    valueCurrency: value != null ? "GBP" : null,
    deadline: null,
    expectedAwardDate: null,
    cpvCodes: [],
    region: text(row.area_name, 120) || null,
    url,
    publishedAt: text(row.decided_date, 10) ? `${text(row.decided_date, 10)}T00:00:00.000Z` : null,
    tags: ["planning"],
    raw,
    opportunityType: "planning",
    decisionStatus: text(row.app_state, 40) || null,
    decisionDate: /^\d{4}-\d{2}-\d{2}$/.test(text(row.decided_date, 10)) ? text(row.decided_date, 10) : null,
    lpa: text(row.area_name, 200) || null,
    siteAddress: address || null,
    postcode: text(row.postcode, 12) || ukPostcode(address),
    applicant,
    agent,
    scopeSummary: scopeSummary(description),
    facilityTypes: facilityTypes(`${title}\n${description}`),
    contactName: agent,
    contactEmail: publishedEmail(blob),
    contactPhone: text(other.agent_tel, 40) || publishedPhone(blob),
  };
}

export async function fetchPlanitNotices(decidedFrom: string, fetchImpl: typeof fetch = fetch) {
  const notices: ParsedNotice[] = [];
  let pages = 0;
  let read = 0;
  let truncated = false;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await fetchImpl(planitSearchUrl(decidedFrom, page), {
      method: "GET",
      redirect: "error",
      headers: { Accept: "application/json", "User-Agent": "JordanPulseRadar/1.0" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Planning feed returned HTTP ${response.status}`);
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("json")) throw new Error("Planning feed did not return JSON.");
    const body = await response.text();
    if (body.length > 1_000_000) throw new Error("Planning feed response exceeds the bounded ingestion size.");
    const root = JSON.parse(body) as { records?: unknown; total?: unknown };
    if (!Array.isArray(root.records)) throw new Error("Planning feed did not return records.");
    pages += 1;
    read += root.records.length;
    for (const record of root.records) {
      const notice = fromPlanitRecord(record);
      if (notice) notices.push(notice);
    }
    const total = typeof root.total === "number" ? root.total : read;
    if (read >= total || root.records.length < PAGE_SIZE) break;
    if (page === MAX_PAGES) truncated = true;
  }
  return { notices, pages, read, truncated };
}
