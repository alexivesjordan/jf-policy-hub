import { parseCsv } from "@/lib/pricer/effort-table";

export const PACKAGE_CSV_HEADER = [
  "sku",
  "product_name",
  "package_no",
  "length_cm",
  "width_cm",
  "height_cm",
  "gross_weight_kg",
  "stackable",
  "max_stack",
  "can_be_on_side",
  "ships_on_pallet_only",
] as const;

export type PackageCsvRow = {
  sku: string;
  product_name: string;
  package_no: number;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  gross_weight_kg: number | null;
  stackable: boolean;
  max_stack: number | null;
  can_be_on_side: boolean;
  ships_on_pallet_only: boolean;
};

export function packagesToCsv(rows: PackageCsvRow[]) {
  const lines = [PACKAGE_CSV_HEADER.join(",")];
  for (const row of rows) {
    lines.push(PACKAGE_CSV_HEADER.map((key) => csvCell(cell(row, key))).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function packagesFromCsv(text: string): { rows: PackageCsvRow[]; error: string } {
  const [header, ...records] = parseCsv(text);
  if (!header) return { rows: [], error: "The CSV needs a sku column." };
  const index = new Map(header.map((name, position) => [name.trim().toLowerCase(), position]));
  if (!index.has("sku")) return { rows: [], error: "The CSV needs a sku column." };
  if (records.length > 5000) return { rows: [], error: "That CSV has too many rows." };
  const rows: PackageCsvRow[] = [];
  const seen = new Set<string>();
  for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
    const record = records[recordIndex] ?? [];
    const rowNumber = recordIndex + 2;
    const column = (name: string) => (record[index.get(name) ?? -1] ?? "").trim();
    const sku = column("sku");
    if (!sku) continue;
    if (sku.length > 80) return { rows: [], error: `Row ${rowNumber}: SKU must be 1 to 80 characters.` };
    const packageNo = column("package_no") === "" ? 1 : whole(column("package_no"), rowNumber, "box", 1, 20);
    if (typeof packageNo !== "number") return { rows: [], error: packageNo };
    const key = `${sku.toLowerCase()}#${packageNo}`;
    if (seen.has(key)) return { rows: [], error: `Row ${rowNumber}: ${sku} box ${packageNo} is repeated.` };
    seen.add(key);
    const lengthCm = optionalWhole(column("length_cm"), rowNumber, "length");
    const widthCm = optionalWhole(column("width_cm"), rowNumber, "width");
    const heightCm = optionalWhole(column("height_cm"), rowNumber, "height");
    const weight = optionalWeight(column("gross_weight_kg"), rowNumber);
    const stackable = optionalBool(column("stackable"), true, rowNumber, "stackable");
    const onSide = optionalBool(column("can_be_on_side"), false, rowNumber, "on side");
    const palletOnly = optionalBool(column("ships_on_pallet_only"), false, rowNumber, "pallet only");
    const maxStack = optionalWhole(column("max_stack"), rowNumber, "max stack", 1, 20);
    const parsed = [lengthCm, widthCm, heightCm, weight, stackable, onSide, palletOnly, maxStack];
    const problem = parsed.find((value) => typeof value === "string");
    if (typeof problem === "string") return { rows: [], error: problem };
    rows.push({
      sku,
      product_name: column("product_name").slice(0, 200),
      package_no: packageNo,
      length_cm: lengthCm as number | null,
      width_cm: widthCm as number | null,
      height_cm: heightCm as number | null,
      gross_weight_kg: weight as number | null,
      stackable: stackable as boolean,
      max_stack: maxStack as number | null,
      can_be_on_side: onSide as boolean,
      ships_on_pallet_only: palletOnly as boolean,
    });
  }
  if (!rows.length) return { rows: [], error: "The CSV has no SKUs." };
  return { rows, error: "" };
}

function cell(row: PackageCsvRow, key: (typeof PACKAGE_CSV_HEADER)[number]) {
  const value = row[key];
  if (typeof value === "boolean") return value ? "yes" : "no";
  return value == null ? "" : String(value);
}

function csvCell(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replaceAll("\"", "\"\"")}"`;
  return value;
}

function whole(value: string, row: number, label: string, min: number, max: number): number | string {
  if (!/^[0-9]+$/.test(value)) return `Row ${row}: ${label} must be a whole number.`;
  const parsed = Number(value);
  if (parsed < min || parsed > max) return `Row ${row}: ${label} must be from ${min} to ${max}.`;
  return parsed;
}

function optionalWhole(value: string, row: number, label: string, min = 1, max = 1000): number | null | string {
  if (!value) return null;
  return whole(value, row, label, min, max);
}

function optionalWeight(value: string, row: number): number | null | string {
  if (!value) return null;
  if (!/^[0-9]+(\.[0-9])?$/.test(value)) return `Row ${row}: weight must have at most one decimal.`;
  const parsed = Number(value);
  if (!(parsed > 0) || parsed > 2000) return `Row ${row}: weight must be greater than 0 and at most 2000 kg.`;
  return parsed;
}

function optionalBool(value: string, fallback: boolean, row: number, label: string): boolean | string {
  if (!value) return fallback;
  const text = value.toLowerCase();
  if (["yes", "true", "y", "1"].includes(text)) return true;
  if (["no", "false", "n", "0"].includes(text)) return false;
  return `Row ${row}: ${label} must be yes or no.`;
}

/** Supplier packing list. Weight is the weight of one piece, not the line total. */
export type PackingListRow = {
  sku: string;
  name: string;
  qty: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
};

const LIST_ALIAS: Record<string, "sku" | "name" | "qty" | "length" | "width" | "height" | "weight"> = {
  sku: "sku",
  name: "name",
  product_name: "name",
  qty: "qty",
  quantity: "qty",
  l: "length",
  length: "length",
  length_cm: "length",
  w: "width",
  width: "width",
  width_cm: "width",
  h: "height",
  height: "height",
  height_cm: "height",
  kg: "weight",
  weight: "weight",
  weight_kg: "weight",
  gross_weight_kg: "weight",
};

export function packingListFromCsv(text: string): { rows: PackingListRow[]; error: string } {
  const [header, ...records] = parseCsv(text.replace(/^\uFEFF/, ""));
  if (!header) return { rows: [], error: "The CSV needs a sku column." };
  const index = new Map<string, number>();
  header.forEach((name, position) => {
    const key = LIST_ALIAS[name.trim().toLowerCase()];
    if (key) index.set(key, position);
  });
  if (!index.has("sku")) return { rows: [], error: "The CSV needs a sku column." };
  if (!index.has("length") || !index.has("width") || !index.has("height") || !index.has("weight")) {
    return { rows: [], error: "The CSV needs length, width, height, and weight columns." };
  }
  if (records.length > 500) return { rows: [], error: "That CSV has too many rows." };
  const rows: PackingListRow[] = [];
  for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
    const record = records[recordIndex] ?? [];
    const rowNumber = recordIndex + 2;
    const column = (name: "sku" | "name" | "qty" | "length" | "width" | "height" | "weight") => {
      const position = index.get(name);
      return position == null ? "" : (record[position] ?? "").trim();
    };
    const sku = column("sku");
    if (!sku) continue;
    if (sku.length > 80) return { rows: [], error: `Row ${rowNumber}: SKU must be 1 to 80 characters.` };
    const qtyText = column("qty");
    const qty = qtyText === "" ? 1 : whole(qtyText, rowNumber, "quantity", 1, 500);
    if (typeof qty !== "number") return { rows: [], error: qty };
    const lengthCm = whole(column("length"), rowNumber, "length", 1, 2000);
    const widthCm = whole(column("width"), rowNumber, "width", 1, 500);
    const heightCm = whole(column("height"), rowNumber, "height", 1, 400);
    const weightKg = optionalWeight(column("weight"), rowNumber);
    if (typeof lengthCm !== "number") return { rows: [], error: lengthCm };
    if (typeof widthCm !== "number") return { rows: [], error: widthCm };
    if (typeof heightCm !== "number") return { rows: [], error: heightCm };
    if (typeof weightKg === "string") return { rows: [], error: weightKg };
    if (weightKg == null) return { rows: [], error: `Row ${rowNumber}: weight is required.` };
    rows.push({
      sku,
      name: column("name").slice(0, 200) || sku,
      qty,
      lengthCm,
      widthCm,
      heightCm,
      weightKg,
    });
  }
  if (!rows.length) return { rows: [], error: "The CSV has no SKUs." };
  return { rows, error: "" };
}
