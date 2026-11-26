import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_RADAR_SETTINGS } from "@/features/radar/defaults";
import { fetchReleasePages, feedUrl, ingestWindow, parseReleases } from "@/features/radar/feed";
import { fetchPlanitNotices } from "@/features/radar/planit";
import { noticeKey } from "@/features/radar/dedupe";
import { planNoticeWrites, type NoticeWrite } from "@/features/radar/plan";
import { formatUkDate } from "@/features/radar/present";
import { deadlineDay, dueReminders, londonDay, reminderCopy } from "@/features/radar/reminders";
import type { RadarScoringConfig, RadarSource, ReminderKind } from "@/features/radar/types";

type SourceResult = {
  ok: boolean;
  pages: number;
  read: number;
  truncated: boolean;
};

function asConfig(row: unknown): RadarScoringConfig {
  if (!row || typeof row !== "object") return DEFAULT_RADAR_SETTINGS;
  const record = row as {
    keywords?: unknown;
    cpv_codes?: unknown;
    value_bands?: unknown;
    exclusions?: unknown;
  };
  const keywords = Array.isArray(record.keywords) ? record.keywords.filter((item): item is string => typeof item === "string") : [];
  const cpvCodes = Array.isArray(record.cpv_codes) ? record.cpv_codes.filter((item): item is string => typeof item === "string") : [];
  const exclusions = Array.isArray(record.exclusions) ? record.exclusions.filter((item): item is string => typeof item === "string") : DEFAULT_RADAR_SETTINGS.exclusions;
  const valueBands = Array.isArray(record.value_bands)
    ? record.value_bands.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const band = item as { label?: unknown; min?: unknown; max?: unknown; points?: unknown };
        const label = typeof band.label === "string" ? band.label : "";
        const points = Number(band.points);
        if (!label || !Number.isFinite(points)) return [];
        return [{
          label,
          min: band.min == null ? null : Number(band.min),
          max: band.max == null ? null : Number(band.max),
          points,
        }];
      })
    : [];
  if (keywords.length === 0) return DEFAULT_RADAR_SETTINGS;
  return { ...DEFAULT_RADAR_SETTINGS, keywords, cpvCodes, valueBands, exclusions };
}

async function loadSettings(admin: SupabaseClient) {
  const { data } = await admin.from("radar_settings").select("keywords, cpv_codes, value_bands, exclusions").eq("id", true).maybeSingle();
  return asConfig(data);
}

async function existingKeys(admin: SupabaseClient, notices: { source: string; noticeId: string }[]) {
  const keys = new Set<string>();
  const ids = [...new Set(notices.map((notice) => notice.noticeId))];
  for (let index = 0; index < ids.length; index += 100) {
    const slice = ids.slice(index, index + 100);
    if (slice.length === 0) continue;
    const { data, error } = await admin.from("radar_opportunities").select("source, notice_id").in("notice_id", slice);
    if (error) throw new Error("Could not read existing notices.");
    for (const row of data ?? []) {
      const record = row as { source?: string; notice_id?: string };
      if (record.source && record.notice_id) keys.add(noticeKey({ source: record.source, noticeId: record.notice_id }));
    }
  }
  return keys;
}

async function saveWrites(admin: SupabaseClient, writes: NoticeWrite[]) {
  for (let index = 0; index < writes.length; index += 40) {
    const slice = writes.slice(index, index + 40);
    const { error } = await admin.from("radar_opportunities").upsert(slice, { onConflict: "source,notice_id" });
    if (error) throw new Error("Could not store notices.");
  }
}

async function readSource(source: "find-a-tender" | "contracts-finder", from: string, fetchImpl: typeof fetch): Promise<{ result: SourceResult; notices: ReturnType<typeof parseReleases>["notices"] }> {
  const batch = await fetchReleasePages(source, feedUrl(source, from), fetchImpl);
  const parsed = parseReleases(source, batch.releases);
  return {
    result: { ok: true, pages: batch.pages, read: batch.releases.length, truncated: batch.truncated },
    notices: parsed.notices,
  };
}

async function sendReminders(admin: SupabaseClient, today: string) {
  const { data, error } = await admin
    .from("radar_opportunities")
    .select("id, title, buyer, deadline, expected_award_date, owner_id, status")
    .not("owner_id", "is", null)
    .neq("status", "dismissed")
    .neq("status", "pushed_to_hubspot")
    .limit(500);
  if (error || !Array.isArray(data) || data.length === 0) return 0;
  const rows = data as {
    id: string;
    title: string;
    buyer: string;
    deadline: string | null;
    expected_award_date: string | null;
    owner_id: string;
    status: string;
  }[];
  const ids = rows.map((row) => row.id);
  const prior = await admin.from("radar_reminders").select("opportunity_id, kind").in("opportunity_id", ids);
  const already = new Map<string, ReminderKind[]>();
  for (const row of prior.data ?? []) {
    const record = row as { opportunity_id?: string; kind?: ReminderKind };
    if (!record.opportunity_id || !record.kind) continue;
    already.set(record.opportunity_id, [...(already.get(record.opportunity_id) ?? []), record.kind]);
  }
  let sent = 0;
  for (const row of rows) {
    const kinds = dueReminders({
      status: row.status,
      ownerId: row.owner_id,
      deadline: row.deadline,
      expectedAwardDate: row.expected_award_date,
      already: already.get(row.id) ?? [],
      today,
    });
    for (const kind of kinds) {
      const when = kind === "award" ? formatUkDate(row.expected_award_date) : formatUkDate(deadlineDay(row.deadline));
      const copy = reminderCopy(kind, row.title, row.buyer, when);
      const reserved = await admin.from("radar_reminders").insert({
        opportunity_id: row.id,
        kind,
        notified_user_id: row.owner_id,
      });
      if (reserved.error) continue;
      const note = await admin.from("notifications").insert({
        user_id: row.owner_id,
        title: copy.title,
        body: copy.body,
        kind: "radar",
        link: `/sales/radar?notice=${row.id}`,
      });
      if (note.error) {
        await admin.from("radar_reminders").delete().eq("opportunity_id", row.id).eq("kind", kind);
        continue;
      }
      sent += 1;
    }
  }
  return sent;
}

export async function runRadarIngest(admin: SupabaseClient, input: { now?: Date; lookbackDays?: number; fetchImpl?: typeof fetch } = {}) {
  const now = input.now ?? new Date();
  const window = ingestWindow(now, input.lookbackDays ?? 2);
  const fetchImpl = input.fetchImpl ?? fetch;
  const config = await loadSettings(admin);
  const empty = (): SourceResult => ({ ok: false, pages: 0, read: 0, truncated: false });
  const collected: Awaited<ReturnType<typeof readSource>>["notices"] = [];
  const sources: Record<RadarSource, SourceResult> = {
    "find-a-tender": empty(),
    "contracts-finder": empty(),
    planit: empty(),
  };
  const jobs: { source: "find-a-tender" | "contracts-finder"; from: string }[] = [
    { source: "find-a-tender", from: window.ftsFrom },
    { source: "contracts-finder", from: window.cfFrom },
  ];
  const results = await Promise.allSettled(jobs.map((job) => readSource(job.source, job.from, fetchImpl)));
  for (let index = 0; index < jobs.length; index += 1) {
    const source = jobs[index].source;
    const result = results[index];
    if (result.status === "fulfilled") {
      sources[source] = result.value.result;
      collected.push(...result.value.notices);
    }
  }
  try {
    const planning = await fetchPlanitNotices(window.cfFrom, fetchImpl);
    sources.planit = { ok: true, pages: planning.pages, read: planning.read, truncated: planning.truncated };
    collected.push(...planning.notices);
  } catch {
    sources.planit = empty();
  }
  if (!sources["find-a-tender"].ok && !sources["contracts-finder"].ok && !sources.planit.ok) {
    throw new Error("The tender and planning feeds failed.");
  }
  const known = await existingKeys(admin, collected);
  const plan = planNoticeWrites({ notices: collected, existingKeys: known, config });
  await saveWrites(admin, plan.writes);
  const reminders = await sendReminders(admin, londonDay(now));
  return {
    lookbackDays: window.days,
    findATender: sources["find-a-tender"],
    contractsFinder: sources["contracts-finder"],
    planit: sources.planit,
    inserted: plan.inserted,
    updated: plan.updated,
    skipped: plan.skipped,
    reminders,
  };
}
