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

const PALLET_FIELDS = [
  ["lengthCm", "length"],
  ["widthCm", "width"],
  ["depthCm", "depth"],
  ["weightKg", "weight"],
] as const;

function blankPalletValue(value: unknown) {
  return value == null || value === "" || Number(value) === 0;
}

type PalletDraft = { lengthCm?: number | null; widthCm?: number | null; depthCm?: number | null; weightKg?: number | null };

export function inspectPallets(rows: PalletDraft[], mode: "issue" | "preview") {
  const problems: string[] = [];
  const pallets: PalletLine[] = [];
  if (rows.length > 30) problems.push("At most 30 pallets.");
  rows.forEach((row, index) => {
    const name = "Pallet " + (index + 1);
    const missing = PALLET_FIELDS.filter(([key]) => blankPalletValue(row?.[key]));
    if (missing.length === PALLET_FIELDS.length) return;
    if (missing.length) {
      missing.forEach(([, label]) => problems.push(`${name}: enter ${label}`));
      return;
    }
    const lengthCm = Number(row.lengthCm);
    const widthCm = Number(row.widthCm);
    const depthCm = Number(row.depthCm);
    const weightKg = Number(row.weightKg);
    if (![lengthCm, widthCm, depthCm].every((value) => Number.isInteger(value) && value >= 1 && value <= 1000)) {
      problems.push(`${name}: length, width and depth must be whole centimetres from 1 to 1000`);
      return;
    }
    if (!(weightKg > 0) || weightKg > 2000 || !oneDecimal(weightKg)) {
      problems.push(`${name}: weight must be greater than 0, at most 2000 kg, with one decimal`);
      return;
    }
    pallets.push({ lengthCm, widthCm, depthCm, weightKg });
  });
  if (mode === "issue" && pallets.length < 1 && problems.length === 0) problems.push("Enter at least one pallet.");
  const gross = palletGrossKg(pallets);
  if (pallets.length && gross > 100000) problems.push("Gross weight is invalid.");
  return { pallets, problems };
}

export function acceptedPallets(rows: PalletDraft[]) {
  const checked = inspectPallets(rows, "preview");
  return { pallets: checked.pallets, invalid: checked.problems.length > 0 };
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
