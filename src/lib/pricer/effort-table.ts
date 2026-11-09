import { readFileSync } from "fs";
import path from "path";

export type BuildLocation = "site" | "hq";
export type YesNo = "Y" | "N";

export type EffortRow = {
  sku: string | null;
  productName: string;
  productLine: string | null;
  category: string;
  buildLocation: BuildLocation;
  crateAtHq: boolean;
  buildCrew: number | null;
  buildMinutes: number | null;
  hqBuildCrew: number | null;
  hqBuildMinutes: number | null;
  sitePositionMinutes: number | null;
  complexity: "low" | "med" | "high" | null;
  carryCrew: number | null;
  weightBand: string;
  unitWeightKg: number | null;
  assembledWeightKg: number | null;
  assembledDimsMm: string | null;
  wheeled: YesNo | null;
  carryDifficulty: "low" | "med" | "high" | null;
  pumpTruckOk: boolean;
  floorFixing: "Y" | "N" | "maybe";
  reviewFlag: string | null;
  /** Set on rows loaded from the SKU effort table. Null means the effort is unknown. */
  needsAssembly?: boolean | null;
  status?: "suggested" | "confirmed";
  /** each keeps the machine repeat rate. tile and m2 are strict quantity × minutes. */
  effortUnit?: "each" | "tile" | "m2" | null;
  /** Flooring is laid before sled track. Those phases are never overlapped. */
  workPhase?: "job" | "floor" | "sled" | null;
};

function num(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Minimal CSV splitter that keeps quoted commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.trim().length > 0));
}

export function parseEffortTable(csv: string): EffortRow[] {
  const [header, ...records] = parseCsv(csv);
  const index = new Map(header.map((name, position) => [name.trim(), position]));
  const col = (record: string[], name: string) => (record[index.get(name) ?? -1] ?? "").trim();

  return records.map((record) => {
    const location = col(record, "build_location") === "hq" ? "hq" : "site";
    const complexity = col(record, "complexity");
    const difficulty = col(record, "carry_difficulty");
    const fixing = col(record, "floor_fixing_required");
    return {
      sku: col(record, "sku") || null,
      productName: col(record, "product_name"),
      productLine: col(record, "product_line") || null,
      category: col(record, "category"),
      buildLocation: location,
      crateAtHq: col(record, "crate_at_hq").toUpperCase() === "Y",
      buildCrew: num(col(record, "build_crew")),
      buildMinutes: num(col(record, "build_minutes")),
      hqBuildCrew: num(col(record, "hq_build_crew")),
      hqBuildMinutes: num(col(record, "hq_build_minutes")),
      sitePositionMinutes: num(col(record, "site_position_minutes")),
      complexity: complexity === "low" || complexity === "med" || complexity === "high" ? complexity : null,
      carryCrew: num(col(record, "carry_crew")),
      weightBand: col(record, "weight_band"),
      unitWeightKg: num(col(record, "unit_weight_kg")),
      assembledWeightKg: num(col(record, "assembled_weight_kg")),
      assembledDimsMm: col(record, "assembled_dims_mm") || null,
      wheeled: col(record, "wheeled").toUpperCase() === "Y" ? "Y" : col(record, "wheeled") ? "N" : null,
      carryDifficulty: difficulty === "low" || difficulty === "med" || difficulty === "high" ? difficulty : null,
      pumpTruckOk: col(record, "pump_truck_ok").toUpperCase() === "Y",
      floorFixing: fixing === "Y" || fixing === "maybe" ? fixing : "N",
      reviewFlag: col(record, "review_flag") || null,
    };
  });
}

let cached: EffortRow[] | null = null;

export function loadBundledEffortTable(): EffortRow[] {
  if (cached) return cached;
  const file = path.join(process.cwd(), "src/lib/pricer/product-effort-table.csv");
  cached = parseEffortTable(readFileSync(file, "utf8"));
  return cached;
}
