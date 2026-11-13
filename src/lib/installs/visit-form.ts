export const RISK_ITEMS = [
  { key: "accessClear", label: "Access route is clear" },
  { key: "floorSuitable", label: "Floor can take the equipment" },
  { key: "powerSafe", label: "Power is safe to work around" },
  { key: "handlingPlanned", label: "Manual handling is planned" },
  { key: "peopleBriefed", label: "People on site are briefed" },
] as const;

export type RiskKey = (typeof RISK_ITEMS)[number]["key"];
export type RiskAnswers = Record<RiskKey, boolean | null> & { notes: string };
export type SheetLine = { code: string; description: string; reportedJob: string; qty?: string; fromOrder?: boolean };
export type SheetPart = { code: string; description: string; qty: string };

export type SheetDraft = {
  visitType: "install" | "service";
  sheetOn: string;
  returnedOn: string;
  contactName: string;
  address: string;
  phone: string;
  orderNo: string;
  jobNo: string;
  serviceContract: boolean | null;
  timeOn: string;
  timeOff: string;
  parkingFee: string;
  service: boolean;
  delivery: boolean;
  installation: boolean;
  warranty: boolean;
  kitAsOrdered: boolean;
  kitNotes: string;
  lines: SheetLine[];
  workCarriedOut: string;
  parts: SheetPart[];
  locationOk: boolean | null;
  workOk: boolean | null;
  siteOk: boolean | null;
  engineerName: string;
  vehicleReg: string;
  customerName: string;
};

export type OrderLineView = {
  sku: string;
  description: string;
  productLine: string | null;
  category: string | null;
  qty: number | null;
};

export const FORM_NOTICES = {
  signing: "By signing this document you are agreeing to all of the content detailed above.",
  hours:
    "Extra man hours resulting from inaccurate information will be a charge at £25 (+ vat) per hour per man. Normal installation hours are between 0800 and 1700. Jordan Fitness accept no responsibility for the suitability of floors or walls.",
} as const;

export function emptyRisk(): RiskAnswers {
  return {
    accessClear: null,
    floorSuitable: null,
    powerSafe: null,
    handlingPlanned: null,
    peopleBriefed: null,
    notes: "",
  };
}

export function riskFromUnknown(value: unknown): RiskAnswers | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const answers = emptyRisk();
  answers.notes = typeof row.notes === "string" ? row.notes : "";
  for (const item of RISK_ITEMS) {
    const raw = row[item.key];
    if (raw === true || raw === "true") answers[item.key] = true;
    else if (raw === false || raw === "false") answers[item.key] = false;
  }
  return answers;
}

export function validateRisk(answers: RiskAnswers) {
  for (const item of RISK_ITEMS) {
    if (answers[item.key] !== true && answers[item.key] !== false) return "Answer every check.";
  }
  return null;
}

function boolAnswer(value: boolean | null, label: string) {
  if (value == null) return `Answer ${label}.`;
  return null;
}

export function validateSheet(sheet: SheetDraft) {
  if (sheet.visitType !== "install" && sheet.visitType !== "service") return "Choose install or service.";
  if (!sheet.sheetOn) return "Add the date.";
  if (!sheet.customerName.trim()) return "Add the customer name.";
  if (!sheet.engineerName.trim()) return "Add the engineer name.";
  if (!sheet.kitAsOrdered) return "Confirm all kit was installed as ordered.";
  if (!sheet.workCarriedOut.trim()) return "Add the work carried out.";
  return (
    boolAnswer(sheet.locationOk, "the location question") ||
    boolAnswer(sheet.workOk, "whether the customer is satisfied") ||
    boolAnswer(sheet.siteOk, "whether the site was left satisfactory")
  );
}

export function jobSheetCompleteLine(orderNo: string, customerName: string) {
  const label = orderNo.trim() || customerName.trim();
  return label ? `Job sheet for ${label} is complete.` : "Job sheet is complete.";
}

export function vehicleChoiceProblem(registration: string, vans: { registration: string }[]) {
  if (vans.length === 0) return null;
  if (!vans.some((van) => van.registration === registration)) return "Choose a van.";
  return null;
}

function londonOffsetMinutes(instant: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour"), pick("minute"), pick("second"));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

export function londonLocalToUtcIso(day: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (!year || !month || !date || hour == null || minute == null || hour > 23 || minute > 59) return null;
  let utc = Date.UTC(year, month - 1, date, hour, minute, 0);
  for (let pass = 0; pass < 2; pass += 1) {
    utc = Date.UTC(year, month - 1, date, hour, minute, 0) - londonOffsetMinutes(new Date(utc)) * 60_000;
  }
  return new Date(utc).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function clock(day: string, time: string) {
  if (!day || !time) return null;
  return londonLocalToUtcIso(day, time);
}

export function sheetPayload(
  sheet: SheetDraft,
  files: { engineerSignatureFileId: string; customerSignatureFileId: string; pdfFileId: string },
) {
  const lines = sheet.lines
    .map((line) => ({
      code: line.code.trim(),
      description: line.description.trim(),
      reportedJob: line.reportedJob.trim(),
      qty: (line.qty ?? "").trim(),
    }))
    .filter((line) => line.code || line.description || line.reportedJob);
  const parts = sheet.parts
    .map((part) => ({ code: part.code.trim(), description: part.description.trim(), qty: part.qty.trim() || "1" }))
    .filter((part) => part.code || part.description);
  return {
    visitType: sheet.visitType,
    sheetOn: sheet.sheetOn || null,
    returnedOn: sheet.returnedOn || null,
    contactName: sheet.contactName.trim(),
    address: sheet.address.trim(),
    phone: sheet.phone.trim(),
    orderNo: sheet.orderNo.trim(),
    jobNo: sheet.jobNo.trim(),
    serviceContract: sheet.serviceContract,
    timeOn: clock(sheet.sheetOn, sheet.timeOn),
    timeOff: clock(sheet.sheetOn, sheet.timeOff),
    parkingFee: sheet.parkingFee.trim() || null,
    service: sheet.service,
    delivery: sheet.delivery,
    installation: sheet.installation,
    warranty: sheet.warranty,
    workCarriedOut: sheet.workCarriedOut.trim(),
    locationOk: sheet.locationOk,
    workOk: sheet.workOk,
    siteOk: sheet.siteOk,
    engineerName: sheet.engineerName.trim(),
    vehicleReg: sheet.vehicleReg.trim(),
    customerName: sheet.customerName.trim(),
    lines,
    parts,
    engineerSignatureFileId: files.engineerSignatureFileId,
    customerSignatureFileId: files.customerSignatureFileId,
    pdfFileId: files.pdfFileId,
  };
}

export function blankLine(): SheetLine {
  return { code: "", description: "", reportedJob: "", qty: "1" };
}

export function blankPart(): SheetPart {
  return { code: "", description: "", qty: "1" };
}
