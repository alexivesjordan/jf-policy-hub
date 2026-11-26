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
    });
    if (present) updated += 1;
    else inserted += 1;
  }
  return { writes, inserted, updated, skipped };
}
