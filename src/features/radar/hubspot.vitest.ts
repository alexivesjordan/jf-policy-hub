import { describe, expect, it } from "vitest";
import { buildHubSpotDeal, createHubSpotDeal, hubspotConnected, hubspotDealUrl } from "@/features/radar/hubspot";
import { assertPlanitUrl, fromPlanitRecord } from "@/features/radar/planit";

const draft = buildHubSpotDeal({
  title: "Gym equipment",
  buyer: "Council",
  valueAmount: 50000,
  closeDate: "2027-02-26",
  scopeSummary: "Strength equipment for a leisure centre",
  url: "https://www.find-tender.service.gov.uk/Notice/1",
  pipelineId: "pipe",
  stageId: "stage",
  ownerId: "owner",
});

describe("HubSpot deals", () => {
  it("stays disconnected until a token is configured", () => {
    expect(hubspotConnected(undefined)).toBe(false);
    expect(hubspotConnected("  ")).toBe(false);
    expect(hubspotConnected("token")).toBe(true);
  });

  it("creates a deal through the CRM API and does not call any other host", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(url));
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token");
      const body = JSON.parse(String(init?.body)) as { properties: Record<string, string> };
      expect(body.properties.dealname).toBe("Gym equipment");
      expect(body.properties.amount).toBe("50000");
      expect(body.properties.closedate).toBe("2027-02-26");
      expect(body.properties.pipeline).toBe("pipe");
      expect(body.properties.dealstage).toBe("stage");
      expect(body.properties.hubspot_owner_id).toBe("owner");
      expect(body.properties.description).toContain("https://www.find-tender.service.gov.uk/Notice/1");
      return new Response(JSON.stringify({ id: "99" }), { status: 201, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    await expect(createHubSpotDeal(draft, { token: "token", fetchImpl })).resolves.toEqual({ id: "99" });
    expect(calls).toEqual(["https://api.hubapi.com/crm/v3/objects/deals"]);
    expect(hubspotDealUrl("246", "99")).toBe("https://app.hubspot.com/contacts/246/record/0-3/99");
  });

  it("does not call HubSpot when the pipeline or stage is missing", async () => {
    const fetchImpl = (async () => {
      throw new Error("HubSpot was called");
    }) as typeof fetch;
    await expect(createHubSpotDeal({ ...draft, pipelineId: "" }, { token: "token", fetchImpl })).rejects.toThrow(/pipeline/);
  });
});

describe("PlanIt planning applications", () => {
  it("rejects a planning URL that is not the PlanIt search", () => {
    expect(() => assertPlanitUrl("https://planning.data.gov.uk/entity.json")).toThrow(/permitted/);
    expect(assertPlanitUrl("https://www.planit.org.uk/api/applics/json?pg_sz=1")).toMatch(/planit\.org\.uk/);
  });

  it("extracts a granted application", () => {
    const notice = fromPlanitRecord({
      name: "KingsLynn/26/01113/F",
      description: "Erection of a leisure centre with a fitness suite at School Road. Contact build@example.test.",
      address: "School Road, King's Lynn PE31 8TE",
      postcode: "PE31 8TE",
      app_state: "Permitted",
      decided_date: "2026-09-04",
      area_name: "Kings Lynn",
      url: "https://online.west-norfolk.gov.uk/online-applications/applicationDetails.do?keyVal=1",
      link: "https://www.planit.org.uk/planapplic/KingsLynn/26/01113/F/",
      other_fields: {
        applicant_company: "Example Leisure Ltd",
        agent_company: "Example Agents",
        agent_tel: "01553 000000",
        applicant_name: "available in the source",
      },
    });
    expect(notice?.opportunityType).toBe("planning");
    expect(notice?.buyer).toBe("Example Leisure Ltd");
    expect(notice?.applicant).toBe("Example Leisure Ltd");
    expect(notice?.agent).toBe("Example Agents");
    expect(notice?.decisionStatus).toBe("Permitted");
    expect(notice?.decisionDate).toBe("2026-09-04");
    expect(notice?.postcode).toBe("PE31 8TE");
    expect(notice?.lpa).toBe("Kings Lynn");
    expect(notice?.facilityTypes).toContain("Leisure centre");
    expect(notice?.contactEmail).toBe("build@example.test");
    expect(notice?.url).toMatch(/^https:\/\/online\.west-norfolk\.gov\.uk\//);
  });
});
