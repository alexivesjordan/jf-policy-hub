import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { coversJobTypes, coversRegion, emailNeedsCheck, insuranceInDate, jobTypesForKit, rankSubcontractors, selectionGate, type SubcontractorRecord } from "@/lib/subcontractors/capability";
import { buildSubcontractorDraft, isWeekday } from "@/lib/subcontractors/draft";
import { CHECK_EMAILS, SEEDED_SUBCONTRACTORS } from "@/lib/subcontractors/seed-data";
import { INSURANCE_MAX_BYTES, insurancePathOk, planInsuranceUpload } from "@/lib/pulse/access-upload";

const today = "2026-11-13";

function row(overrides: Partial<SubcontractorRecord> = {}): SubcontractorRecord {
  return {
    id: "10000000-0000-4000-8000-000000000099",
    name: "Example",
    contactName: null,
    phone: null,
    emails: ["crew@example.com"],
    regions: [],
    jobTypes: ["install"],
    maxCrew: null,
    status: "preferred",
    notes: null,
    insurance: [{ id: "doc", fileId: "file", expiresOn: "2027-01-01", label: null }],
    ...overrides,
  };
}

describe("insurance gate", () => {
  it("treats the expiry day as in date and blocks selection without a document", () => {
    expect(insuranceInDate([], today)).toBe(false);
    expect(insuranceInDate([{ expiresOn: "2026-11-12" }], today)).toBe(false);
    expect(insuranceInDate([{ expiresOn: today }], today)).toBe(true);
    expect(selectionGate(row({ insurance: [] }), today).reason).toBe("No in-date insurance");
    const blocked = rankSubcontractors([row({ insurance: [] })], { postcode: "LS1 4DY", jobTypes: ["install"], crew: 2, today })[0];
    expect(blocked.selectable).toBe(false);
    expect(blocked.preselected).toBe(false);
  });

  it("plans a direct storage path and refuses a file over the insurance bucket limit", () => {
    const plan = planInsuranceUpload("application/pdf", 8 * 1024 * 1024);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      const path = `ops/10000000-0000-4000-8000-000000000001/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.${plan.extension}`;
      expect(insurancePathOk("10000000-0000-4000-8000-000000000001", path)).toBe(true);
    }
    expect(planInsuranceUpload("application/pdf", INSURANCE_MAX_BYTES + 1).ok).toBe(false);
    expect(planInsuranceUpload("video/mp4", 1024).ok).toBe(false);
  });
});

describe("capability filter", () => {
  it("pre-ticks an insured preferred company that covers the region and the job", () => {
    const choices = rankSubcontractors([
      row({ name: "Amazon Leisure", emails: ["sarah@amazon-leisure"], jobTypes: ["install", "flooring"] }),
      row({ name: "GRS", jobTypes: ["install"] }),
      row({ name: "Eamon", regions: ["Ireland"], status: "on_hold" }),
      row({ name: "Globalise", regions: ["West Country"], status: "on_hold" }),
      row({ name: "Power Leisure", emails: ["service@poerleisure.info"], regions: ["Scotland", "UK"], jobTypes: ["install"] }),
      row({ name: "Taylor Made", maxCrew: 4, status: "active" }),
    ], { postcode: "LS1 4DY", jobTypes: ["install", "flooring"], crew: 2, today });
    const byName = Object.fromEntries(choices.map((choice) => [choice.name, choice]));
    expect(byName["Amazon Leisure"].preselected).toBe(true);
    expect(byName["Amazon Leisure"].checkEmail).toBe(true);
    expect(byName.GRS.selectable).toBe(true);
    expect(byName.GRS.preselected).toBe(false);
    expect(byName.Eamon.preselected).toBe(false);
    expect(byName.Globalise.preselected).toBe(false);
    expect(byName["Taylor Made"].preselected).toBe(false);
  });

  it("keeps Ireland, the West Country and Scotland apart", () => {
    expect(coversRegion(["Ireland"], "D02 AF30")).toBe(true);
    expect(coversRegion(["Ireland"], "LS1 4DY")).toBe(false);
    expect(coversRegion(["West Country"], "EX1 1AE")).toBe(true);
    expect(coversRegion(["Scotland", "UK"], "EH1 1YZ")).toBe(true);
    expect(coversRegion(["Scotland", "UK"], "LS1 4DY")).toBe(true);
    expect(coversRegion([], "LS1 4DY")).toBe(true);
    expect(coversRegion([], "D02 AF30")).toBe(false);
    expect(coversRegion(["Scotland"], "GL1 1AA")).toBe(false);
    expect(jobTypesForKit([{ description: "FID Bench", category: "bench" }])).toEqual(["install"]);
    expect(coversJobTypes(["install"], ["install", "flooring"])).toBe(false);
  });
});

describe("seed and draft", () => {
  it("keeps the sheet rows and leaves insurance out of the migration", () => {
    expect(SEEDED_SUBCONTRACTORS).toHaveLength(11);
    expect(emailNeedsCheck(["sarah@amazon-leisure", "chris@draigfitness.com"])).toBe(true);
    expect(emailNeedsCheck(["chris@draigfitness.com"])).toBe(false);
    expect([...CHECK_EMAILS]).toContain("service@poerleisure.info");
    const sql = readFileSync(new URL("../../../supabase/migrations/20261113160000_subcontractors.sql", import.meta.url), "utf8");
    for (const seeded of SEEDED_SUBCONTRACTORS) {
      expect(sql).toContain(seeded.name.replaceAll("'", "''"));
      if (seeded.email) expect(sql).toContain(seeded.email);
    }
    expect(sql).not.toContain("monday.com");
    expect(sql).toContain("No insurance documents");
  });

  it("writes the kit and weekdays without a price", () => {
    const draft = buildSubcontractorDraft({
      orderNumber: "SO-00490",
      customerName: "Riverside Gym",
      postcode: "LS1 4DY",
      lines: [{ qty: 2, description: "FID Bench" }],
      dates: ["2026-11-16", "2026-11-21"],
    });
    expect(draft.text).toContain("2× FID Bench");
    expect(draft.text).toContain("16/11/2026");
    expect(draft.text).not.toContain("21/11/2026");
    expect(draft.text).not.toMatch(/£/);
    expect(isWeekday("2026-11-21")).toBe(false);
  });
});
