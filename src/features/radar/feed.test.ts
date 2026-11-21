import { describe, expect, it } from "vitest";
import { fetchTenderBatch, radarPreview } from "./feed";
const source = "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?updatedFrom=2026-11-18T00%3A00%3A00";
const release = {
  id: "075021-2026", ocid: "ocds-h6vhtk-12345", date: "2026-11-18T12:00:00Z",
  buyer: { name: "County Council" },
  tender: { title: "Gym equipment supply", description: "Strength machines for leisure centre",
    value: { amount: 22000, currency: "GBP" },
    tenderPeriod: { endDate: "2026-12-20T12:00:00Z" } },
};
function fake(body: unknown, type = "application/json") {
  return (async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": type } })) as typeof fetch;
}
describe("official OCDS feed ingestion", () => {
  it("rejects arbitrary destination and insecure HTTP URLs", async () => {
    await expect(fetchTenderBatch("https://evil.example/api/release", fake({ releases: [] }))).rejects.toThrow(/permitted/);
    await expect(fetchTenderBatch("http://www.find-tender.service.gov.uk/api/release", fake({ releases: [] }))).rejects.toThrow(/permitted/);
  });
  it("normalises, deduplicates and evaluates public release batches", async () => {
    const batch = await fetchTenderBatch(source, fake({ releases: [release, release, { id: "bad" }] }));
    expect(batch.readCount).toBe(3);
    expect(batch.unrecognisedReleases).toBe(1);
    expect(batch.candidates).toHaveLength(1);
    expect(radarPreview(batch,new Date("2026-11-19T10:00:00Z"))[0].assessment.relevant).toBe(true);
  });
  it("blocks incompatible or malformed feed content", async () => {
    await expect(fetchTenderBatch(source, fake({ notices: [] }))).rejects.toThrow(/releases/);
    await expect(fetchTenderBatch(source, fake({ releases: [] }, "text/html"))).rejects.toThrow(/JSON/);
  });
});
