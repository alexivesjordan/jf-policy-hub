export type DutyUnit = "kg" | "100kg" | "tonne" | "item";

export type DutyPiece = {
  op: "add" | "sub" | "min" | "max";
  kind: "percent" | "specific";
  percent?: number;
  gbp?: number;
  per?: DutyUnit;
};

export type ParsedDuty = {
  pieces: DutyPiece[];
};

export type DutyContext = {
  customsValuePence: number;
  quantity: number | null;
  netWeightKg: number | null;
};

const PLUS = new Set(["04", "12", "19", "20", "21", "25", "27", "29", "35", "36", "37"]);

export function pieceOp(expressionId: string | null | undefined, first: boolean): DutyPiece["op"] {
  if (first) return "add";
  if (expressionId === "15") return "min";
  if (expressionId === "17") return "max";
  if (expressionId === "02") return "sub";
  if (!expressionId || expressionId === "01" || PLUS.has(expressionId)) return "add";
  return "add";
}

export function unitFromCode(code: string | null | undefined): DutyUnit | null {
  if (!code) return null;
  const unit = code.toUpperCase();
  if (unit === "KGM") return "kg";
  if (unit === "DTN") return "100kg";
  if (unit === "TNE") return "tonne";
  if (unit === "NAR" || unit === "NPR") return "item";
  return null;
}

export function isSimpleDuty(duty: ParsedDuty) {
  return duty.pieces.every((piece) => piece.op === "add");
}

export function adValoremPercent(duty: ParsedDuty) {
  return duty.pieces.filter((piece) => piece.op === "add" && piece.kind === "percent").reduce((total, piece) => total + (piece.percent ?? 0), 0);
}

export function dutyNeeds(duty: ParsedDuty) {
  const needs = new Set<"quantity" | "net weight">();
  for (const piece of duty.pieces) {
    if (piece.kind !== "specific") continue;
    needs.add(piece.per === "item" ? "quantity" : "net weight");
  }
  return needs;
}

function unitsOf(per: DutyUnit, context: DutyContext) {
  if (per === "item") return context.quantity;
  if (context.netWeightKg == null) return null;
  if (per === "kg") return context.netWeightKg;
  if (per === "100kg") return context.netWeightKg / 100;
  return context.netWeightKg / 1000;
}

function piecePence(piece: DutyPiece, context: DutyContext) {
  if (piece.kind === "percent") return Math.round((context.customsValuePence * (piece.percent ?? 0)) / 100);
  const units = unitsOf(piece.per ?? "kg", context);
  if (units == null) {
    const need = piece.per === "item" ? "quantity" : "net weight";
    throw new Error(need === "quantity" ? "This duty needs a quantity." : "This duty needs a net weight.");
  }
  return Math.round((piece.gbp ?? 0) * units * 100);
}

/** Duty in pence for a known customs value. */
export function evaluateDutyPence(duty: ParsedDuty, context: DutyContext) {
  let current = 0;
  for (const piece of duty.pieces) {
    const amount = piecePence(piece, context);
    if (piece.op === "add") current += amount;
    else if (piece.op === "sub") current -= amount;
    else if (piece.op === "min") current = Math.max(current, amount);
    else current = Math.min(current, amount);
  }
  return Math.max(0, current);
}

export function emptyDuty(): ParsedDuty {
  return { pieces: [{ op: "add", kind: "percent", percent: 0 }] };
}
