import { describe, expect, it } from "vitest";
import { assertOfficialFeedUrl, fetchReleasePages, feedUrl } from "@/features/radar/feed";
import { fromOcdsRelease } from "@/features/radar/parse";
import { authorisedCron } from "@/features/radar/cron-auth";
import { parseRadarSettings } from "@/features/radar/settings";

const release = {
  id: "112323-2026",
  ocid: "ocds-h6vhtk-07c518",
  date: "2026-11-26T17:14:31Z",
  tag: ["tender"],
  buyer: { name: "Royal Cornwall Hospital Trust" },
  tender: {
    title: "Gym equipment for the leisure centre",
    description: "Strength equipment",
    classification: { scheme: "CPV", id: "37420000" },
    value: { amount: 50000, currency: "GBP" },
    tenderPeriod: { endDate: "2027-01-07T12:00:00Z" },
    awardPeriod: { startDate: "2027-02-26T00:00:00Z" },
    items: [{ additionalClassifications: [{ scheme: "CPV", id: "37421000-8" }], deliveryAddresses: [{ region: "South West" }] }],
    documents: [{ url: "https://evil.example/notice" }, { url: "https://www.find-tender.service.gov.uk/Notice/112323-2026" }],
  },
};

describe("radar feed and review handoff", () => {
  it("reads an OCDS release and ignores an unofficial document link", () => {
    const notice = fromOcdsRelease("find-a-tender", release);
    expect(notice?.noticeId).toBe("112323-2026");
    expect(notice?.buyer).toBe("Royal Cornwall Hospital Trust");
    expect(notice?.valueAmount).toBe(50000);
    expect(notice?.expectedAwardDate).toBe("2027-02-26");
    expect(notice?.region).toBe("South West");
    expect(notice?.cpvCodes).toEqual(["37420000", "37421000"]);
    expect(notice?.url).toBe("https://www.find-tender.service.gov.uk/Notice/112323-2026");
    expect(fromOcdsRelease("contracts-finder", {
      ...release,
      id: "cf-1",
      parties: [{ name: "Loughborough College Group", roles: ["buyer"], address: { locality: "Loughborough", countryName: "UK" } }],
      tender: {
        ...release.tender,
        items: [{ deliveryAddresses: [{ countryName: "British Oversea Territories" }, { countryName: "United Kingdom" }] }],
      },
    })?.region).toBe("Loughborough");
    expect(fromOcdsRelease("contracts-finder", { ...release, id: "" })).toBeNull();
  });

  it("rejects a feed URL that is not the official search endpoint", () => {
    expect(() => assertOfficialFeedUrl("find-a-tender", "https://evil.example/api/1.0/ocdsReleasePackages")).toThrow(/permitted/);
    expect(() => assertOfficialFeedUrl("find-a-tender", "http://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages")).toThrow(/permitted/);
    expect(feedUrl("contracts-finder", "2026-11-24")).toMatch(/^https:\/\/www\.contractsfinder\.service\.gov\.uk\/Published\/Notices\/OCDS\/Search\?/);
  });

  it("follows the next page only on the official host", async () => {
    const start = feedUrl("find-a-tender", "2026-11-24T00:00:00");
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const next = calls.length === 1
        ? "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?limit=100&stages=tender&cursor=abc"
        : "https://evil.example/api/1.0/ocdsReleasePackages?cursor=1";
      return new Response(JSON.stringify({
        releases: [{ id: `n-${calls.length}` }],
        links: { next },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const batch = await fetchReleasePages("find-a-tender", start, fetchImpl);
    expect(batch.pages).toBe(2);
    expect(batch.releases).toHaveLength(2);
    expect(batch.truncated).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatch(/^https:\/\/www\.find-tender\.service\.gov\.uk\//);
  });

  it("authorises the cron header and checks settings input", () => {
    expect(authorisedCron("Bearer secret", "")).toBe(false);
    expect(authorisedCron("Bearer no", "secret")).toBe(false);
    expect(authorisedCron("Bearer secret", "secret")).toBe(true);
    expect(parseRadarSettings({ keywords: "gym\nfitness", cpvCodes: "3742\nbad", bands: [] }).ok).toBe(false);
    const parsed = parseRadarSettings({
      keywords: "Gym\ngym\nleisure centre",
      cpvCodes: "37420000-8",
      bands: [{ label: "Core", min: "1000", max: "5000", points: "10" }, { label: "", min: "", max: "", points: "" }],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.config.keywords).toEqual(["gym", "leisure centre"]);
      expect(parsed.config.cpvCodes).toEqual(["37420000"]);
      expect(parsed.config.valueBands).toHaveLength(1);
    }
  });
});
