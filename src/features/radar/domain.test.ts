import { describe, expect, it } from "vitest";
import { assessCandidate, candidateKey, fromOcdsRelease, setNoticeLink, uniqueReleases } from "./domain";

const raw = {
  id: "075021-2026", ocid: "ocds-h6vhtk-000001", date: "2026-11-19T09:00:00Z",
  buyer: { name: "Test Borough Council" },
  tag: ["tender"],
  tender: {
    title: "Supply and installation of fitness equipment for leisure centre",
    description: "Cardio machines and strength equipment",
    value: { amount: 65000, currency: "GBP" },
    tenderPeriod: { endDate: "2026-12-12T12:00:00Z" },
    items: [{ classification: { scheme: "CPV", id: "37440000" } }],
  },
};
const parsed = () => fromOcdsRelease(raw)!;

describe("radar source processing", () => {
  it("rejects missing source identity and date", () => {
    expect(fromOcdsRelease({ ...raw, id: "" })).toBeNull();
    expect(fromOcdsRelease({ ...raw, date: "invalid" })).toBeNull();
  });
  it("preserves source ID, buyer, value and classifications", () => {
    const c = parsed();
    expect(candidateKey(c)).toBe("find-a-tender:075021-2026");
    expect(c.ocid).toBe("ocds-h6vhtk-000001");
    expect(c.buyerName).toBe("Test Borough Council");
    expect(c.valueAmount).toBe(65000);
    expect(c.cpvCodes).toEqual(["37440000"]);
  });
  it("ranks fitness equipment opportunities and explains why", () => {
    const a = assessCandidate(parsed(), new Date("2026-11-19T10:00:00Z"));
    expect(a.priority).toBe("high");
    expect(a.relevant).toBe(true);
    expect(a.evidence.length).toBeGreaterThan(2);
  });
  it("does not treat every mention of a sports centre as equipment procurement", () => {
    const c = parsed();
    c.title = "Cleaning contract for leisure centre";
    c.description = "Cleaning services";
    c.cpvCodes = ["90910000"];
    expect(assessCandidate(c).priority).toBe("low");
  });
  it("recognises expired tenders without inventing open status", () => {
    const c = parsed();
    c.deadlineAt = "2026-11-01T00:00:00Z";
    expect(assessCandidate(c, new Date("2026-11-19T00:00:00Z")).warnings.join(" ")).toMatch(/passed/);
  });
  it("does not trust arbitrary external links from a public notice", () => {
    const c = parsed();
    expect(setNoticeLink(c, "https://evil.example/Notice/123").sourceUrl).toBe(c.sourceUrl);
    expect(setNoticeLink(c, "https://www.find-tender.service.gov.uk/Notice/075021-2026").sourceUrl).toMatch(/075021/);
  });
  it("deduplicates releases, not all updates to the same procurement", () => {
    const a = parsed();
    const b = { ...a, releaseId: "075022-2026" };
    expect(uniqueReleases([a, a, b])).toHaveLength(2);
  });
});
