import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coversJobTypes, coversRegion, emailNeedsCheck, insuranceInDate, jobTypesForKit, markAlreadyEmailed, rankSubcontractors, selectionGate, type SubcontractorRecord } from "@/lib/subcontractors/capability";
import { isWeekday } from "@/lib/subcontractors/draft";
import { CHECK_EMAILS, SEEDED_SUBCONTRACTORS } from "@/lib/subcontractors/seed-data";
import { INSURANCE_MAX_BYTES, insuranceBytesMatch, insurancePathOk, planInsuranceUpload } from "@/lib/pulse/access-upload";

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
    expect(insuranceBytesMatch("application/pdf", new Uint8Array(Buffer.from("%PDF-1.4")))).toBe(true);
    expect(insuranceBytesMatch("application/pdf", new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false);
  });
});

describe("capability filter", () => {
  it("pre-ticks an insured preferred company that covers the region and the job", () => {
    const choices = rankSubcontractors([
      row({ name: "Amazon Leisure", emails: ["sarah@amazon-leisure"], jobTypes: ["install", "flooring"] }),
      row({ name: "Local Fit", emails: ["jobs@localfit.example"], jobTypes: ["install", "flooring"] }),
      row({ name: "GRS", jobTypes: ["install"] }),
      row({ name: "Eamon", regions: ["Ireland"], status: "on_hold" }),
      row({ name: "Globalise", regions: ["West Country"], status: "on_hold" }),
      row({ name: "Power Leisure", emails: ["service@poerleisure.info"], regions: ["Scotland", "UK"], jobTypes: ["install"] }),
      row({ name: "Taylor Made", maxCrew: 4, status: "active" }),
    ], { postcode: "LS1 4DY", jobTypes: ["install", "flooring"], crew: 2, today });
    const byName = Object.fromEntries(choices.map((choice) => [choice.name, choice]));
    expect(byName["Local Fit"].preselected).toBe(true);
    expect(byName["Amazon Leisure"].preselected).toBe(false);
    expect(byName["Amazon Leisure"].selectable).toBe(false);
    expect(byName["Amazon Leisure"].reason).toBe("Check email");
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
    const sql = readFileSync(new URL("../../../supabase/migrations/20261113220000_subcontractors.sql", import.meta.url), "utf8");
    for (const seeded of SEEDED_SUBCONTRACTORS) {
      expect(sql).toContain(seeded.name.replaceAll("'", "''"));
      if (seeded.email) expect(sql).toContain(seeded.email);
    }
    expect(sql).not.toContain("monday.com");
    expect(sql).toContain("No insurance documents");
  });

  it("keeps weekends off the booking calendar", () => {
    expect(isWeekday("2026-11-16")).toBe(true);
    expect(isWeekday("2026-11-21")).toBe(false);
  });
});

describe("ask another subcontractor", () => {
  it("keeps the insurance, area, and job-type filters and refuses anyone already emailed", () => {
    const need = { postcode: "LS1 4DY", jobTypes: ["install"], crew: 2, today };
    const local = row({ id: "local", name: "Local Fit" });
    const emailed = row({ id: "sent", name: "Already Sent" });
    const uninsured = row({ id: "bare", name: "Bare", insurance: [] });
    const ireland = row({ id: "eire", name: "Eire Only", regions: ["Ireland"] });
    const choices = markAlreadyEmailed(rankSubcontractors([local, emailed, uninsured, ireland], need), ["sent"]);
    expect(choices.find((choice) => choice.id === "local")).toMatchObject({ selectable: true, preselected: true });
    expect(choices.find((choice) => choice.id === "sent")).toMatchObject({ selectable: false, preselected: false, reason: "Already emailed" });
    expect(choices.find((choice) => choice.id === "bare")?.reason).toBe("No in-date insurance");
    expect(choices.find((choice) => choice.id === "eire")?.reason).toBe("Outside the area");
    const page = readFileSync(path.join(process.cwd(), "src/components/subcontractor-install.tsx"), "utf8");
    expect(page).toContain("Ask another subcontractor");
    expect(page).toContain("<SubcontractorQuote");
  });
});
