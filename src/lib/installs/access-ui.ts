export const ACCESS_CHIPS = ["Not sent", "Sent", "Submitted"] as const;
export type AccessChip = (typeof ACCESS_CHIPS)[number];

export const KANBAN_COLUMNS = [
  ["quoting", "Quoting"],
  ["booked", "Booked"],
  ["awaiting_access", "Awaiting access info"],
  ["ready", "Ready"],
  ["completed", "Completed"],
] as const;

export function accessChip(access: {
  sentAt?: string | null;
  submittedAt?: string | null;
  mediaCount?: number | null;
} | null | undefined): AccessChip {
  if (access?.submittedAt) return "Submitted";
  if (access?.sentAt) return "Sent";
  return "Not sent";
}

/** A short charges list cannot be scrolled, so the terms are already read. */
export function termsBoxReady(scrollHeight: number, clientHeight: number, scrolled: boolean) {
  if (scrollHeight <= clientHeight + 12) return true;
  return scrolled;
}

export function kanbanColumn(stage: unknown) {
  const value = String(stage ?? "");
  return KANBAN_COLUMNS.some(([id]) => id === value) ? value : "booked";
}

/** Ready and Awaiting look alike on a card, so the chip names the access state. */
export function kanbanAccessChip(stage: unknown, mediaCount: unknown): "Awaiting form" | "Submitted" | "No photos" | null {
  if (stage === "awaiting_access") return "Awaiting form";
  if (stage !== "ready") return null;
  const count = Number(mediaCount);
  if (Number.isFinite(count) && count === 0) return "No photos";
  return "Submitted";
}

/** First column that has a card. Quoting stays empty until a later phase. */
export function firstFilledKanban(stages: unknown[]) {
  const found = KANBAN_COLUMNS.find(([id]) => stages.some((stage) => kanbanColumn(stage) === id));
  return found?.[0] ?? null;
}

const BASIS_LABELS: Record<string, string> = {
  cost_plus_25: "Cost + 25%",
  additional_installer_time: "Charged as additional installer time",
  at_cost: "At cost",
  tbc: "To be confirmed",
};

/** Plain words for every charges-grid basis, including ones with no rate. */
export function basisText(basis?: string | null) {
  if (!basis) return "";
  return BASIS_LABELS[basis] ?? basis.replaceAll("_", " ");
}

const ANSWER_FIELDS: { keys: string[]; label: string }[] = [
  { keys: ["groundFloor"], label: "Ground floor" },
  { keys: ["floorNumber"], label: "Floor" },
  { keys: ["hasLift"], label: "Lift" },
  { keys: ["levelStepFree"], label: "Step-free" },
  { keys: ["doubleDoorsOrClear", "doubleDoors"], label: "Door clearance" },
  { keys: ["openingWidthMm", "openingWidth"], label: "Opening width mm" },
  { keys: ["openingHeightMm", "openingHeight"], label: "Opening height mm" },
  { keys: ["tailLiftAdjacent", "tailLift"], label: "Tail-lift" },
  { keys: ["dropZone"], label: "Drop zone" },
  { keys: ["startAtEight"], label: "Start at 08:00" },
  { keys: ["roomClear"], label: "Room clear" },
  { keys: ["floorFinished"], label: "Floor finished" },
  { keys: ["townCentre"], label: "Town centre" },
  { keys: ["siteHoursStart", "hoursStart"], label: "Hours start" },
  { keys: ["siteHoursEnd", "hoursEnd"], label: "Hours end" },
];

export function labelFor(key: string) {
  return ANSWER_FIELDS.find((field) => field.keys.includes(key))?.label ?? key;
}

export function answerText(value: unknown) {
  if (value === true || value === "yes") return "Yes";
  if (value === false || value === "no") return "No";
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

/** Form order, with empty answers left out. */
export function orderedAnswers(answers: Record<string, unknown> | null | undefined) {
  const source = answers ?? {};
  const used = new Set<string>();
  const rows: { key: string; label: string; text: string }[] = [];
  for (const field of ANSWER_FIELDS) {
    const key = field.keys.find((candidate) => answerText(source[candidate]) != null);
    if (!key) continue;
    used.add(key);
    rows.push({ key, label: field.label, text: answerText(source[key]) ?? "" });
  }
  for (const key of Object.keys(source)) {
    if (used.has(key) || ANSWER_FIELDS.some((field) => field.keys.includes(key))) continue;
    const text = answerText(source[key]);
    if (text == null) continue;
    rows.push({ key, label: key, text });
  }
  return rows;
}

/** Weekends are never working days, so a span only paints Monday to Friday. */
export function installCoversDay(startOn: string, endOn: string, day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !startOn || !endOn) return false;
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return startOn.slice(0, 10) <= day && endOn.slice(0, 10) >= day;
}
