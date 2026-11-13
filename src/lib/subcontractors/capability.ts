import { CHECK_EMAILS } from "@/lib/subcontractors/seed-data";

export type SubcontractorStatus = "active" | "preferred" | "on_hold" | "inactive";

export type InsuranceDoc = {
  id: string;
  fileId: string;
  expiresOn: string;
  label: string | null;
  bucket?: string | null;
  path?: string | null;
  url?: string | null;
};

export type SubcontractorRecord = {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  emails: string[];
  regions: string[];
  jobTypes: string[];
  maxCrew: number | null;
  status: SubcontractorStatus;
  notes: string | null;
  insurance: InsuranceDoc[];
};

export type QuoteNeed = {
  postcode: string;
  jobTypes: string[];
  crew: number | null;
  today: string;
};

export type QuoteChoice = SubcontractorRecord & {
  insuranceInDate: boolean;
  checkEmail: boolean;
  selectable: boolean;
  preselected: boolean;
  reason: string | null;
};

const SCOTLAND = new Set(["AB", "DD", "DG", "EH", "FK", "G", "HS", "IV", "KA", "KW", "KY", "ML", "PA", "PH", "TD", "ZE"]);
const WEST_COUNTRY = new Set(["BA", "BS", "DT", "EX", "PL", "TA", "TQ", "TR"]);

export function insuranceInDate(documents: { expiresOn: string }[], today: string) {
  return documents.some((doc) => /^\d{4}-\d{2}-\d{2}/.test(doc.expiresOn) && doc.expiresOn.slice(0, 10) >= today);
}

export function emailNeedsCheck(emails: readonly string[]) {
  return emails.some((email) => {
    const value = email.trim().toLowerCase();
    if (!value) return false;
    if ((CHECK_EMAILS as readonly string[]).includes(value)) return true;
    return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  });
}

/** A blank region list means the sheet stated no limit, so UK postcodes match and Ireland does not. */
export function coversRegion(regions: readonly string[], postcode: string) {
  const area = postcodeArea(postcode);
  if (!area.kind) return false;
  const named = regions.map((region) => region.trim().toLowerCase()).filter(Boolean);
  if (named.length === 0) return area.kind !== "ireland";
  const ukWide = named.some((region) => region === "uk" || region === "united kingdom" || region === "nationwide");
  if (area.kind === "ireland") return named.some((region) => region.includes("ireland"));
  if (ukWide) return true;
  if (area.kind === "scotland") return named.some((region) => region.includes("scotland"));
  if (area.kind === "west_country") return named.some((region) => region.includes("west country"));
  return false;
}

export function coversJobTypes(offered: readonly string[], required: readonly string[]) {
  const has = new Set(offered.map((type) => type.trim().toLowerCase()).filter(Boolean));
  return required.every((type) => has.has(type.trim().toLowerCase()));
}

export function jobTypesForKit(lines: { category?: string | null; description?: string | null }[]) {
  const types = ["install"];
  const blob = lines.map((line) => `${line.category ?? ""} ${line.description ?? ""}`).join("\n");
  if (/\bfloor|\btiles?\b|matting|platform insert/i.test(blob)) types.push("flooring");
  return types;
}

export function selectionGate(row: Pick<SubcontractorRecord, "status" | "emails" | "insurance">, today: string) {
  if (row.status === "inactive") return { ok: false as const, reason: "Inactive" };
  if (!insuranceInDate(row.insurance, today)) return { ok: false as const, reason: "No in-date insurance" };
  if (row.emails.every((email) => !email.trim())) return { ok: false as const, reason: "No email" };
  return { ok: true as const, reason: null };
}

export function rankSubcontractors(rows: readonly SubcontractorRecord[], need: QuoteNeed): QuoteChoice[] {
  return rows.map((row) => {
    const gate = selectionGate(row, need.today);
    const checkEmail = emailNeedsCheck(row.emails);
    let reason = gate.reason;
    let capable = gate.ok && (row.status === "active" || row.status === "preferred");
    if (capable && !coversJobTypes(row.jobTypes, need.jobTypes)) {
      capable = false;
      reason = "Does not cover this job";
    } else if (capable && !coversRegion(row.regions, need.postcode)) {
      capable = false;
      reason = "Outside the area";
    } else if (capable && row.maxCrew != null && need.crew != null && need.crew > row.maxCrew) {
      capable = false;
      reason = `Up to ${row.maxCrew}`;
    } else if (gate.ok && row.status === "on_hold") {
      reason = "On hold";
    }
    return {
      ...row,
      insuranceInDate: insuranceInDate(row.insurance, need.today),
      checkEmail,
      selectable: gate.ok,
      preselected: capable,
      reason: capable ? null : reason,
    };
  });
}

export function postcodeArea(postcode: string): { kind: "ireland" | "scotland" | "west_country" | "uk" | ""; area: string } {
  const compact = postcode.toUpperCase().replace(/\s+/g, "");
  if (!compact) return { kind: "", area: "" };
  if (/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(compact)) {
    const area = compact.match(/^([A-Z]{1,2})/)?.[1] ?? "";
    if (SCOTLAND.has(area)) return { kind: "scotland", area };
    if (WEST_COUNTRY.has(area)) return { kind: "west_country", area };
    return { kind: "uk", area };
  }
  if (/^[AC-FHKNPRTV-Y]\d{2}[A-Z0-9]{4}$/.test(compact)) return { kind: "ireland", area: compact.slice(0, 3) };
  return { kind: "", area: "" };
}
