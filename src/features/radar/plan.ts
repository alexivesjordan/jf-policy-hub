import { dedupeNotices, noticeKey } from "@/features/radar/dedupe";
import { boundedPayload } from "@/features/radar/parse";
import { scoreOpportunity } from "@/features/radar/scoring";
import type { ParsedNotice, RadarScoringConfig } from "@/features/radar/types";

export type NoticeWrite = {
  source: ParsedNotice["source"];
  notice_id: string;
  ocid: string | null;
  title: string;
  buyer: string;
  value_amount: number | null;
  value_currency: string | null;
  deadline: string | null;
  expected_award_date: string | null;
  cpv_codes: string[];
  region: string | null;
  url: string;
  raw_payload: unknown;
  score: number;
  match_reasons: string[];
  published_at: string | null;
  description: string;
  opportunity_type: ParsedNotice["opportunityType"];
  decision_status: string | null;
  decision_date: string | null;
  lpa: string | null;
  site_address: string | null;
  postcode: string | null;
  applicant: string | null;
  agent: string | null;
  scope_summary: string;
  facility_types: string[];
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
};

function openNotice(tags: string[]) {
  if (tags.length === 0) return true;
  return tags.some((tag) => tag === "tender" || tag === "planning");
}

export function planNoticeWrites(input: {
  notices: ParsedNotice[];
  existingKeys: Set<string>;
  config: RadarScoringConfig;
}) {
  const writes: NoticeWrite[] = [];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const notice of dedupeNotices(input.notices)) {
    const key = noticeKey(notice);
    const present = input.existingKeys.has(key);
    if (!openNotice(notice.tags)) {
      skipped += 1;
      continue;
    }
    const scored = scoreOpportunity(
      {
        title: notice.title,
        description: notice.description,
        buyer: notice.buyer,
        cpvCodes: notice.cpvCodes,
        valueAmount: notice.valueAmount,
        decisionStatus: notice.decisionStatus,
      },
      input.config,
    );
    if (!scored.relevant && !present) {
      skipped += 1;
      continue;
    }
    writes.push({
      source: notice.source,
      notice_id: notice.noticeId,
      ocid: notice.ocid,
      title: notice.title,
      buyer: notice.buyer,
      value_amount: notice.valueAmount,
      value_currency: notice.valueCurrency,
      deadline: notice.deadline,
      expected_award_date: notice.expectedAwardDate,
      cpv_codes: notice.cpvCodes,
      region: notice.region,
      url: notice.url,
      raw_payload: boundedPayload(notice.raw),
      score: scored.score,
      match_reasons: scored.reasons,
      published_at: notice.publishedAt,
      description: notice.description,
      opportunity_type: notice.opportunityType,
      decision_status: notice.decisionStatus,
      decision_date: notice.decisionDate,
      lpa: notice.lpa,
      site_address: notice.siteAddress,
      postcode: notice.postcode,
      applicant: notice.applicant,
      agent: notice.agent,
      scope_summary: notice.scopeSummary,
      facility_types: notice.facilityTypes,
      contact_name: notice.contactName,
      contact_email: notice.contactEmail,
      contact_phone: notice.contactPhone,
    });
    if (present) updated += 1;
    else inserted += 1;
  }
  return { writes, inserted, updated, skipped };
}
