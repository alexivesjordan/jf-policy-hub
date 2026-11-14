import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RISK_ITEMS, emptyRisk, sheetPayload, validateSheet, type SheetDraft } from "@/lib/installs/visit-form";
import { buildVisitPdf } from "@/lib/installs/visit-pdf";
import { pdfBytesToLayoutText } from "@/lib/quotes/pdf-text";

const REMOVED = ["ladderCheck", "callOutCharge", "overnightStay", "fixingWall", "fixingFloor"] as const;

/** The fields the job sheet form still collects, with the answers a submit needs. */
function currentFormSheet(): SheetDraft {
  return {
    visitType: "install",
    sheetOn: "2026-11-13",
    returnedOn: "",
    contactName: "Alex Customer",
    address: "12 Quay Street, Norwich",
    phone: "01603 000000",
    orderNo: "SO-00526",
    jobNo: "SO-00526",
    serviceContract: false,
    timeOn: "09:00",
    timeOff: "15:30",
    parkingFee: "",
    service: false,
    delivery: false,
    installation: true,
    warranty: false,
    kitAsOrdered: true,
    kitNotes: "",
    lines: [],
    workCarriedOut: "Installed the kit and levelled it.",
    parts: [{ code: "", description: "", qty: "1" }],
    locationOk: true,
    workOk: true,
    siteOk: true,
    engineerName: "Lewis",
    vehicleReg: "",
    customerName: "Harbour Leisure",
  };
}

function latestFunction(name: string) {
  const dir = path.join(process.cwd(), "supabase/migrations");
  const files = readdirSync(dir).filter((file) => file.endsWith(".sql")).sort();
  let body = "";
  for (const file of files) {
    const sql = readFileSync(path.join(dir, file), "utf8");
    const marker = `create or replace function public.${name}`;
    const start = sql.lastIndexOf(marker);
    if (start < 0) continue;
    const open = sql.indexOf("$$", start);
    const close = sql.indexOf("$$", open + 2);
    body = sql.slice(open + 2, close);
  }
  return body;
}

function requiredPayloadKeys(body: string) {
  const keys = new Set<string>();
  for (const block of body.split(/raise exception/i).slice(0, -1)) {
    for (const match of block.matchAll(/p_sheet->>'(\w+)'/g)) keys.add(match[1]!);
  }
  return [...keys];
}

describe("job sheet save matches the form", () => {
  const sheet = currentFormSheet();
  const payload = sheetPayload(sheet, {
    engineerSignatureFileId: "11111111-1111-4111-8111-111111111111",
    customerSignatureFileId: "22222222-2222-4222-8222-222222222222",
    pdfFileId: "33333333-3333-4333-8333-333333333333",
  });

  it("saves a payload built from the current form", () => {
    expect(validateSheet(sheet)).toBeNull();
    const save = latestFunction("install_save_visit_sheet");
    const required = requiredPayloadKeys(save);
    expect(required).toEqual(expect.arrayContaining([
      "customerName",
      "engineerName",
      "workCarriedOut",
      "engineerSignatureFileId",
      "customerSignatureFileId",
      "pdfFileId",
    ]));
    for (const key of required) {
      const value = payload[key as keyof typeof payload];
      expect(value == null || value === "" ? null : value, key).not.toBeNull();
    }
    expect(payload.visitType).toBe("install");
    expect(save).toContain("insert into ops.visit_sheets");
    expect(save).toContain("insert into ops.visit_sheet_lines");
  });

  it("does not require a field the form no longer collects", () => {
    const save = latestFunction("install_save_visit_sheet");
    const commit = latestFunction("install_commit_visit");
    const risk = latestFunction("install_save_visit_risk");
    for (const key of REMOVED) {
      expect(save).not.toContain(key);
      expect(commit).not.toContain(key);
      expect(risk).not.toContain(key);
      expect(payload).not.toHaveProperty(key);
    }
    expect(save).not.toContain("Confirm the ladder check.");
    const answers = emptyRisk();
    for (const item of RISK_ITEMS) answers[item.key] = true;
    for (const item of RISK_ITEMS) expect(risk).toContain(`'${item.key}'`);
    expect(Object.keys(answers).filter((key) => key !== "notes").sort()).toEqual([...RISK_ITEMS.map((item) => item.key)].sort());
  });

  it("leaves the removed questions out of the PDF pack", async () => {
    const text = await pdfBytesToLayoutText(await buildVisitPdf({ sheet, riskLines: RISK_ITEMS.map((item) => ({ label: item.label, answer: "Yes" })), riskNotes: "" }));
    expect(text).toContain("All kit installed as ordered");
    expect(text).toContain("Installed the kit and levelled it.");
    expect(text).not.toMatch(/ladder|call out|overnight|fixing to wall|fixing to floor|receipts|suitability of floors|Equipment \d/i);
  });
});
