import { estimatedValue, facilityTypes, publishedEmail, publishedPhone, scopeSummary, ukPostcode } from "@/features/radar/extract";
import type { ParsedNotice, RadarSource } from "@/features/radar/types";

const HOSTS: Record<RadarSource, string[]> = {
  "find-a-tender": ["www.find-tender.service.gov.uk"],
  "contracts-finder": ["www.contractsfinder.service.gov.uk"],
  planit: ["www.planit.org.uk"],
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function trim(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : null;
}

function dateOnly(value: unknown) {
  const iso = safeDate(value);
  return iso ? iso.slice(0, 10) : null;
}

function cpvCode(value: unknown) {
  const digits = trim(value, 40).replace(/\D/g, "");
  if (digits.length < 2) return null;
  return digits.slice(0, 8);
}

function money(value: unknown) {
  const row = asRecord(value);
  const amount = typeof row.amount === "number" ? row.amount : Number(row.amount);
  if (!Number.isFinite(amount) || amount < 0 || amount > 999_999_999_999_999) return { amount: null, currency: null };
  const currency = trim(row.currency, 3).toUpperCase();
  return {
    amount: Math.round(amount * 100) / 100,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
  };
}

const GENERIC_PLACE = /^(uk|u\.k\.|united kingdom|great britain|europe|rest of the world|british overseas territories|british oversea territories|channel islands|isle of man)$/i;

function placeOf(address: Record<string, unknown>) {
  const locality = trim(address.locality, 120);
  if (locality && !GENERIC_PLACE.test(locality)) return locality;
  const region = trim(address.region, 120);
  if (region && !GENERIC_PLACE.test(region)) return region;
  return null;
}

function officialUrl(source: RadarSource, noticeId: string, candidates: string[]) {
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" && HOSTS[source].includes(url.hostname)) return url.toString();
    } catch {
      continue;
    }
  }
  const path = encodeURIComponent(noticeId);
  if (source === "find-a-tender") return `https://www.find-tender.service.gov.uk/Notice/${path}`;
  return `https://www.contractsfinder.service.gov.uk/Notice/${path}`;
}

export function boundedPayload(raw: unknown) {
  try {
    const text = JSON.stringify(raw);
    if (text.length <= 200_000) return raw;
    return { truncated: true };
  } catch {
    return { truncated: true };
  }
}

export function fromOcdsRelease(source: RadarSource, raw: unknown): ParsedNotice | null {
  const release = asRecord(raw);
  const noticeId = trim(release.id, 180);
  if (!noticeId) return null;
  const tender = asRecord(release.tender);
  const buyer = asRecord(release.buyer);
  const parties = asArray(release.parties).map(asRecord);
  const buyerParty = parties.find((party) => asArray(party.roles).some((role) => trim(role, 40) === "buyer"));
  const cpv = new Set<string>();
  const classification = asRecord(tender.classification);
  const main = cpvCode(classification.id);
  if (main) cpv.add(main);
  for (const item of asArray(tender.items)) {
    const row = asRecord(item);
    const primary = cpvCode(asRecord(row.classification).id);
    if (primary) cpv.add(primary);
    for (const extra of asArray(row.additionalClassifications)) {
      const code = cpvCode(asRecord(extra).id);
      if (code) cpv.add(code);
    }
  }
  const addresses = [
    asRecord(buyerParty?.address),
    ...parties.map((party) => asRecord(party.address)),
    ...asArray(tender.items).flatMap((item) => asArray(asRecord(item).deliveryAddresses).map(asRecord)),
  ];
  let region: string | null = null;
  for (const address of addresses) {
    region = placeOf(address);
    if (region) break;
  }
  const value = money(tender.value);
  const award = asRecord(tender.awardPeriod);
  const documents = asArray(tender.documents).map((item) => trim(asRecord(item).url, 500)).filter(Boolean);
  const description = trim(tender.description, 4_000);
  const contact = asRecord(buyerParty?.contactPoint);
  const addressText = addresses.map((address) => [trim(address.streetAddress, 200), trim(address.postalCode, 20)].filter(Boolean).join(", ")).find(Boolean) ?? "";
  const postcode = ukPostcode(addressText) ?? ukPostcode(description);
  const contactBlob = `${trim(contact.email, 200)} ${trim(contact.telephone, 40)} ${description}`;
  return {
    source,
    noticeId,
    ocid: trim(release.ocid, 180) || null,
    title: trim(tender.title, 300) || trim(release.title, 300) || "Untitled notice",
    description,
    buyer: trim(buyer.name, 250) || trim(buyerParty?.name, 250) || "Not published",
    valueAmount: value.amount ?? estimatedValue(description),
    valueCurrency: value.currency ?? (estimatedValue(description) != null ? "GBP" : null),
    deadline: safeDate(asRecord(tender.tenderPeriod).endDate),
    expectedAwardDate: dateOnly(award.startDate) ?? dateOnly(award.endDate),
    cpvCodes: [...cpv].slice(0, 20),
    region,
    url: officialUrl(source, noticeId, documents),
    publishedAt: safeDate(release.date),
    tags: asArray(release.tag).map((tag) => trim(tag, 40).toLowerCase()).filter(Boolean).slice(0, 8),
    raw,
    opportunityType: "tender",
    decisionStatus: null,
    decisionDate: null,
    lpa: null,
    siteAddress: addressText || null,
    postcode,
    applicant: trim(buyer.name, 250) || trim(buyerParty?.name, 250) || null,
    agent: null,
    scopeSummary: scopeSummary(description),
    facilityTypes: facilityTypes(`${trim(tender.title, 300)}\n${description}`),
    contactName: trim(contact.name, 200) || null,
    contactEmail: publishedEmail(contactBlob),
    contactPhone: trim(contact.telephone, 40) || publishedPhone(contactBlob),
  };
}
