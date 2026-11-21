import type { PalletLine } from "./rules";

export function palletGrossKg(rows: PalletLine[]) {
  return Math.round(rows.reduce((sum, row) => sum + row.weightKg, 0) * 10) / 10;
}

export function palletLineText(index: number, row: PalletLine) {
  return `Pallet ${index + 1}: ${row.lengthCm} x ${row.widthCm} x ${row.depthCm} cm, ${row.weightKg.toFixed(1)} kg`;
}

export function palletTotalText(rows: PalletLine[]) {
  const count = rows.length;
  return `${count} pallet${count === 1 ? "" : "s"}, ${palletGrossKg(rows).toFixed(1)} kg`;
}

function oneDecimal(value: number) {
  return Math.abs(value * 10 - Math.round(value * 10)) < 1e-6;
}

export function completePallet(row: Partial<PalletLine> | null | undefined): PalletLine | null {
  if (!row) return null;
  const lengthCm = Number(row.lengthCm);
  const widthCm = Number(row.widthCm);
  const depthCm = Number(row.depthCm);
  const weightKg = Number(row.weightKg);
  if (![lengthCm, widthCm, depthCm, weightKg].every((value) => Number.isFinite(value) && value > 0)) return null;
  if (![lengthCm, widthCm, depthCm].every((value) => Number.isInteger(value) && value <= 1000)) return null;
  if (weightKg > 2000 || !oneDecimal(weightKg)) return null;
  return { lengthCm, widthCm, depthCm, weightKg };
}

export function classifyPallet(row: Partial<PalletLine> | null | undefined): "empty" | "invalid" | PalletLine {
  if (!row) return "empty";
  const values = [row.lengthCm, row.widthCm, row.depthCm, row.weightKg];
  if (values.some((value) => value == null || Number(value) === 0)) return "empty";
  return completePallet(row) ?? "invalid";
}

export function acceptedPallets(rows: Partial<PalletLine>[]) {
  const accepted: PalletLine[] = [];
  for (const row of rows) {
    const classified = classifyPallet(row);
    if (classified === "invalid") return { pallets: [] as PalletLine[], invalid: true };
    if (classified !== "empty") accepted.push(classified);
  }
  return { pallets: accepted, invalid: false };
}

export function palletProblems(rows: PalletLine[], mode: "issue" | "preview") {
  const problems: string[] = [];
  if (rows.length > 30) problems.push("At most 30 pallets.");
  if (mode === "issue" && rows.length < 1) problems.push("Enter at least one pallet.");
  rows.forEach((row, index) => {
    if (!completePallet(row)) problems.push("Pallet " + (index + 1) + " is invalid.");
  });
  const gross = palletGrossKg(rows);
  if (rows.length && (gross <= 0 || gross > 100000)) problems.push("Gross weight is invalid.");
  return problems;
}
