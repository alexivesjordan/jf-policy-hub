import { describe, expect, it } from "vitest";
import { fixtureSubcontractorRpc } from "@/lib/subcontractors/fixture-board";

const draig = "10000000-0000-4000-8000-000000000003";

describe("fixture insurance gate", () => {
  it("refuses a quote email until an in-date document is attached", () => {
    const send = { subcontractorId: draig, replyToken: "a".repeat(24), subject: "Install quote", to: "chris@draigfitness.com" };
    expect(() => fixtureSubcontractorRpc("subcontractor_open", { p_dates: ["2026-11-16"], p_sends: [send] })).toThrow(/insurance/);
    fixtureSubcontractorRpc("subcontractor_attach_insurance", { p_subcontractor: draig, p_file: "33333333-3333-4333-8333-333333333333", p_expires: "2027-06-01", p_label: "Liability" });
    const opened = fixtureSubcontractorRpc("subcontractor_open", { p_dates: ["2026-11-16"], p_sends: [send] });
    expect(opened.handled).toBe(true);
    const data = opened.data as { installId: string; threads: { id: string }[] };
    expect(data.installId).toMatch(/^[0-9a-f-]{36}$/);
    expect(data.threads).toHaveLength(1);
  });
});
