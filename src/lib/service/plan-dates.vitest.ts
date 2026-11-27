import { describe, expect, it } from "vitest";
import { addMonths, cadenceMonths, planVisitSeed } from "./plan-dates";

describe("maintenance plan dates", () => {
  it("clamps month-end and leap day the way a calendar does", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2024-02-29", 12)).toBe("2025-02-28");
    expect(addMonths("2024-02-29", 48)).toBe("2028-02-29");
    expect(addMonths("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonths("2023-08-31", 6)).toBe("2024-02-29");
    expect(addMonths("2026-03-31", 6)).toBe("2026-09-30");
    expect(addMonths("2026-01-31", 6)).toBe("2026-07-31");
    expect(addMonths("2026-01-31", 12)).toBe("2027-01-31");
  });

  it("reads cadence only from the sold maintenance options", () => {
    expect(cadenceMonths("twice_yearly")).toBe(6);
    expect(cadenceMonths("twice_yearly_bundle")).toBe(6);
    expect(cadenceMonths("annual")).toBe(12);
    expect(cadenceMonths("annual_bundle")).toBe(12);
    expect(cadenceMonths("extension")).toBeNull();
    expect(cadenceMonths(null)).toBeNull();
  });

  it("leaves a new visit blank unless a plan was opened", () => {
    expect(planVisitSeed(null)).toBeNull();
    const seed = planVisitSeed({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      customerName: "Harbour Fitness",
      addressLine1: "4 Quay Street",
      addressLine2: "",
      city: "Norwich",
      postcode: "NR1 1AA",
      contactName: "Pat Example",
      contactPhone: "01603 000000",
      contactEmail: "desk@example.com",
      nextDueOn: "2026-07-31",
    });
    expect(seed?.visitType).toBe("service");
    expect(seed?.visitOn).toBe("2026-07-31");
    expect(seed?.maintenancePlanId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1");
    expect(seed?.customerName).toBe("Harbour Fitness");
  });
});
