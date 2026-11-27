import { describe, expect, it } from "vitest";
import {
  destinationForVisitLink,
  engineerJobPath,
  engineerPlannerRedirect,
  plannerVisitPath,
  serviceVisitHref,
  visitAudience,
} from "@/lib/service/visit-route";

const visit = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

describe("service visit routing", () => {
  it("sends an engineer to the engineer job view", () => {
    expect(visitAudience("engineer")).toBe("engineer");
    expect(serviceVisitHref("engineer", visit)).toBe(`/service/job/${visit}`);
    expect(engineerJobPath(visit)).toBe(`/service/job/${visit}`);
  });

  it("sends an office user to the planner view", () => {
    expect(visitAudience("admin")).toBe("office");
    expect(visitAudience("ops")).toBe("office");
    expect(visitAudience("none")).toBe("office");
    expect(serviceVisitHref("office", visit)).toBe(`/service/visits/${visit}`);
    expect(plannerVisitPath(visit)).toBe(`/service/visits/${visit}`);
  });

  it("rewrites planner, day, and email links for an engineer", () => {
    expect(destinationForVisitLink("engineer", `/service/visits/${visit}`)).toBe(`/service/job/${visit}`);
    expect(destinationForVisitLink("engineer", `/service/day/${visit}`)).toBe(`/service/job/${visit}`);
    expect(destinationForVisitLink("engineer", `/service/visits/${visit}?from=bell`)).toBe(`/service/job/${visit}?from=bell`);
    expect(destinationForVisitLink("engineer", `https://pulse.example/service/visits/${visit}`)).toBe(
      `https://pulse.example/service/job/${visit}`,
    );
    expect(engineerPlannerRedirect("engineer", `/service/visits/${visit}`)).toBe(`/service/job/${visit}`);
  });

  it("keeps the planner link for an office user", () => {
    expect(destinationForVisitLink("office", `/service/visits/${visit}`)).toBe(`/service/visits/${visit}`);
    expect(destinationForVisitLink("office", `/service/job/${visit}`)).toBe(`/service/visits/${visit}`);
    expect(engineerPlannerRedirect("ops", `/service/visits/${visit}`)).toBeNull();
    expect(engineerPlannerRedirect("engineer", "/service/visits/new")).toBeNull();
    expect(destinationForVisitLink("engineer", "/operations/installs/11111111-1111-4111-8111-1111111111a1")).toBe(
      "/operations/installs/11111111-1111-4111-8111-1111111111a1",
    );
    expect(destinationForVisitLink("engineer", null)).toBeNull();
  });
});
