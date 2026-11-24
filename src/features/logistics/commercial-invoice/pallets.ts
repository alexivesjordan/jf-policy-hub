import type { DimensionKind, PalletLine } from "./rules";

export function palletGrossKg(rows: PalletLine[]) {
  return Math.round(rows.reduce((sum, row) => sum + row.weightKg, 0) * 10) / 10;
}

/** A saved row with no type was entered when every row was a pallet. */
export function dimensionKind(row: { kind?: string | null } | null | undefined): DimensionKind {
  return row?.kind === "parcel" ? "parcel" : "pallet";
}

export function dimensionCounts(rows: { kind?: string | null }[]) {
  return rows.reduce((counts, row) => {
    if (dimensionKind(row) === "parcel") counts.parcels += 1;
    else counts.pallets += 1;
    return counts;
  }, { parcels: 0, pallets: 0 });
}

export function dimensionSummary(rows: { kind?: string | null }[]) {
  const { parcels, pallets } = dimensionCounts(rows);
  const parts = [
    pallets ? `${pallets} pallet${pallets === 1 ? "" : "s"}` : "",
    parcels ? `${parcels} parcel${parcels === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.join(", ");
}

export function dimensionLabel(index: number, row: { kind?: string | null }) {
  return `${index + 1} ${dimensionKind(row) === "parcel" ? "Parcel" : "Pallet"}`;
}

export function palletLineText(index: number, row: PalletLine) {
  return `${dimensionLabel(index, row)}: ${row.lengthCm} x ${row.widthCm} x ${row.depthCm} cm, ${row.weightKg.toFixed(1)} kg`;
}

export function palletTotalText(rows: PalletLine[]) {
  return `${dimensionSummary(rows)}, ${palletGrossKg(rows).toFixed(1)} kg`;
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
  const kind = row.kind === "parcel" || row.kind === "pallet" ? row.kind : undefined;
  return kind ? { lengthCm, widthCm, depthCm, weightKg, kind } : { lengthCm, widthCm, depthCm, weightKg };
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

type PalletDraft = { lengthCm?: number | null; widthCm?: number | null; depthCm?: number | null; weightKg?: number | null; kind?: string | null };

export function inspectPallets(rows: PalletDraft[], mode: "issue" | "preview") {
  const problems: string[] = [];
  const pallets: PalletLine[] = [];
  if (rows.length > 30) problems.push("At most 30 rows.");
  rows.forEach((row, index) => {
    const name = dimensionLabel(index, row);
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
    const kind = row.kind === "parcel" || row.kind === "pallet" ? row.kind : undefined;
    pallets.push(kind ? { lengthCm, widthCm, depthCm, weightKg, kind } : { lengthCm, widthCm, depthCm, weightKg });
  });
  if (mode === "issue" && pallets.length < 1 && problems.length === 0) problems.push("Enter at least one row.");
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
  if (rows.length > 30) problems.push("At most 30 rows.");
  if (mode === "issue" && rows.length < 1) problems.push("Enter at least one row.");
  rows.forEach((row, index) => {
    if (!completePallet(row)) problems.push(dimensionLabel(index, row) + " is invalid.");
  });
  const gross = palletGrossKg(rows);
  if (rows.length && (gross <= 0 || gross > 100000)) problems.push("Gross weight is invalid.");
  return problems;
}
