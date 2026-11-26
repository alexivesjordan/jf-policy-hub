import { describe, expect, it } from "vitest";
import { dedupeNotices, noticeKey } from "@/features/radar/dedupe";
import { planNoticeWrites } from "@/features/radar/plan";
import { DEFAULT_RADAR_SETTINGS } from "@/features/radar/defaults";
import type { ParsedNotice } from "@/features/radar/types";

function notice(overrides: Partial<ParsedNotice> = {}): ParsedNotice {
  return {
    source: "find-a-tender",
    noticeId: "000001-2026",
    ocid: "ocds-h6vhtk-000001",
    title: "Gym equipment supply",
    description: "Strength equipment for a leisure centre",
    buyer: "Test Council",
    valueAmount: 40000,
    valueCurrency: "GBP",
    deadline: "2026-12-20T12:00:00.000Z",
    expectedAwardDate: "2027-01-15",
    cpvCodes: ["37420000"],
    region: "East of England",
    url: "https://www.find-tender.service.gov.uk/Notice/000001-2026",
    publishedAt: "2026-11-20T09:00:00.000Z",
    tags: ["tender"],
    raw: { id: "000001-2026" },
    ...overrides,
  };
}

describe("radar dedupe", () => {
  it("keeps one row per source and notice id, preferring the later publication", () => {
    const older = notice({ publishedAt: "2026-11-01T00:00:00.000Z", title: "Older" });
    const newer = notice({ publishedAt: "2026-11-20T00:00:00.000Z", title: "Newer" });
    const other = notice({ noticeId: "000002-2026", title: "Second" });
    const deduped = dedupeNotices([older, newer, newer, other]);
    expect(deduped).toHaveLength(2);
    expect(deduped.find((item) => item.noticeId === "000001-2026")?.title).toBe("Newer");
  });

  it("does not collapse the same notice id from two sources", () => {
    const fts = notice();
    const cf = notice({ source: "contracts-finder", url: "https://www.contractsfinder.service.gov.uk/Notice/000001-2026" });
    expect(noticeKey(fts)).not.toBe(noticeKey(cf));
    expect(dedupeNotices([fts, cf])).toHaveLength(2);
  });

  it("plans an insert once and an update when the notice already exists", () => {
    const first = planNoticeWrites({
      notices: [notice(), notice()],
      existingKeys: new Set(),
      config: DEFAULT_RADAR_SETTINGS,
    });
    expect(first.inserted).toBe(1);
    expect(first.updated).toBe(0);
    expect(first.writes[0]).not.toHaveProperty("status");
    const again = planNoticeWrites({
      notices: [notice({ title: "Gym equipment supply revised" })],
      existingKeys: new Set([noticeKey(notice())]),
      config: DEFAULT_RADAR_SETTINGS,
    });
    expect(again.updated).toBe(1);
    expect(again.inserted).toBe(0);
  });

  it("skips a new irrelevant notice and still refreshes one already stored", () => {
    const cleaning = notice({
      noticeId: "000009-2026",
      title: "Cleaning contract",
      description: "Cleaning services",
      cpvCodes: ["90910000"],
      tags: ["tender"],
    });
    const fresh = planNoticeWrites({ notices: [cleaning], existingKeys: new Set(), config: DEFAULT_RADAR_SETTINGS });
    expect(fresh.skipped).toBe(1);
    expect(fresh.writes).toHaveLength(0);
    const stored = planNoticeWrites({
      notices: [cleaning],
      existingKeys: new Set([noticeKey(cleaning)]),
      config: DEFAULT_RADAR_SETTINGS,
    });
    expect(stored.updated).toBe(1);
    expect(stored.writes[0]?.score).toBe(0);
  });

  it("skips an award-only release", () => {
    const award = notice({ tags: ["award"] });
    const plan = planNoticeWrites({ notices: [award], existingKeys: new Set(), config: DEFAULT_RADAR_SETTINGS });
    expect(plan.skipped).toBe(1);
    expect(plan.writes).toHaveLength(0);
  });
});
