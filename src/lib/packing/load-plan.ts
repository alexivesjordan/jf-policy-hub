import { packPieces } from "./pack";
import { round1, tenths } from "./space";
import type { DemandLine, PackageSpec, PackPiece, PackedBin, Placement, Unplaced, UnplacedReason, UsableSpace } from "./types";

const MAX_LINES = 500;
const MAX_PIECES = 1000;
const MAX_QTY = 500;
const MAX_EXTRA = 40;

export type LoadLine = {
  id: string;
  sku: string;
  name: string;
  qty: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  stackable: boolean;
  maxStack: number | null;
  canBeOnSide: boolean;
};

export type LoadProblem = {
  sku: string;
  name: string;
  message: string;
};

export type LoadSpaceLabel = {
  code: string;
  name: string;
  kind: "container" | "vehicle";
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  maxGoodsKg: number;
};

export type LoadStop = {
  order: number;
  sku: string;
  name: string;
  x: number;
  y: number;
  z: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
};

export type RoomFor = {
  sku: string;
  name: string;
  count: number;
  atLeast: boolean;
};

export type LoadBinView = {
  index: number;
  placements: Placement[];
  goodsKg: number;
  goodsHeightCm: number;
  volumePct: number;
  weightPct: number;
  freeVolumeM3: number;
  freeKg: number;
  loadOrder: LoadStop[];
  roomFor: RoomFor | null;
};

export type LoadPlanView = {
  version: 1;
  space: LoadSpaceLabel;
  bins: LoadBinView[];
  unplaced: { sku: string; name: string; reason: UnplacedReason; count: number }[];
  problems: LoadProblem[];
  containerCount: number;
};

export function planLoad(lines: LoadLine[], space: UsableSpace, label: LoadSpaceLabel): LoadPlanView {
  const expanded = expandLines(lines);
  if (expanded.pieces.length > MAX_PIECES) {
    return emptyPlan(label, [...expanded.problems, { sku: "", name: "", message: "Too many pieces to plan." }]);
  }
  if (!expanded.pieces.length) {
    const problems = expanded.problems.length
      ? expanded.problems
      : [{ sku: "", name: "", message: "Nothing to place." }];
    return emptyPlan(label, problems);
  }
  const packed = packPieces(expanded.pieces, space, 30);
  const byId = new Map(expanded.pieces.map((piece) => [piece.id, piece]));
  return {
    version: 1,
    space: label,
    bins: packed.bins.map((bin, index) => binView(bin, index, space, byId)),
    unplaced: groupUnplaced(packed.unplaced),
    problems: expanded.problems,
    containerCount: packed.bins.length,
  };
}

/** Reads a saved summary. Returns null when the snapshot is not a plan this screen can draw. */
export function reopenPlan(summary: unknown): LoadPlanView | null {
  if (!summary || typeof summary !== "object") return null;
  const row = summary as LoadPlanView;
  if (row.version !== 1 || !row.space || !Array.isArray(row.bins) || !Array.isArray(row.unplaced)) return null;
  if (row.space.kind !== "container" && row.space.kind !== "vehicle") return null;
  if (![row.space.lengthCm, row.space.widthCm, row.space.heightCm].every((value) => Number.isFinite(value) && value > 0)) return null;
  if (row.containerCount !== row.bins.length) return null;
  for (const bin of row.bins) {
    if (!Array.isArray(bin.placements) || !Array.isArray(bin.loadOrder)) return null;
    if (!Number.isFinite(bin.volumePct) || !Number.isFinite(bin.weightPct)) return null;
  }
  return row;
}

export function collectLoadLines(input: unknown): { lines: LoadLine[]; problems: LoadProblem[] } {
  if (!Array.isArray(input)) return { lines: [], problems: [{ sku: "", name: "", message: "Items must be a list." }] };
  if (input.length > MAX_LINES) return { lines: [], problems: [{ sku: "", name: "", message: "That list has too many rows." }] };
  const lines: LoadLine[] = [];
  const problems: LoadProblem[] = [];
  input.forEach((item, index) => {
    const parsed = lineFrom(item, index);
    if (typeof parsed === "string") problems.push({ sku: "", name: "", message: parsed });
    else lines.push(parsed);
  });
  return { lines, problems };
}

export function linesFromPackages(demand: DemandLine[], packages: PackageSpec[]): { lines: LoadLine[]; problems: LoadProblem[] } {
  const lines: LoadLine[] = [];
  const problems: LoadProblem[] = [];
  const bySku = new Map<string, PackageSpec[]>();
  for (const pack of packages) {
    const list = bySku.get(pack.sku) ?? [];
    list.push(pack);
    bySku.set(pack.sku, list);
  }
  for (const row of demand) {
    const sku = row.sku.trim();
    const name = row.name.trim() || sku || "Item";
    if (!sku) {
      problems.push({ sku: "", name, message: `${name} has no SKU.` });
      continue;
    }
    if (!Number.isInteger(row.qty) || row.qty < 1 || row.qty > MAX_QTY) {
      problems.push({ sku, name, message: `${sku} quantity must be a whole number from 1 to ${MAX_QTY}.` });
      continue;
    }
    const packs = (bySku.get(sku) ?? []).slice().sort((a, b) => a.packageNo - b.packageNo);
    if (!packs.length) {
      problems.push({ sku, name, message: `${sku} has no packaging.` });
      continue;
    }
    for (const pack of packs) {
      if (!complete(pack)) {
        problems.push({ sku, name, message: `${sku} box ${pack.packageNo} has no dimensions.` });
        continue;
      }
      lines.push({
        id: `${sku}#${pack.packageNo}`,
        sku,
        name: pack.name || name,
        qty: row.qty,
        lengthCm: pack.lengthCm!,
        widthCm: pack.widthCm!,
        heightCm: pack.heightCm!,
        weightKg: round1(pack.weightKg!),
        stackable: pack.stackable,
        maxStack: pack.maxStack,
        canBeOnSide: pack.canBeOnSide,
      });
    }
  }
  return { lines, problems };
}

export function linesFromPackingRows(rows: {
  sku: string;
  name: string;
  qty: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
}[]): LoadLine[] {
  return rows.map((row, index) => ({
    id: `csv-${index + 1}-${row.sku}`,
    sku: row.sku,
    name: row.name || row.sku,
    qty: row.qty,
    lengthCm: row.lengthCm,
    widthCm: row.widthCm,
    heightCm: row.heightCm,
    weightKg: row.weightKg,
    stackable: true,
    maxStack: null,
    canBeOnSide: false,
  }));
}

export function loadPlanCsv(plan: LoadPlanView) {
  const header = ["container", "load_order", "sku", "name", "from_back_cm", "from_left_cm", "from_floor_cm", "length_cm", "width_cm", "height_cm", "kg"];
  const lines = [header.join(",")];
  for (const bin of plan.bins) {
    for (const stop of bin.loadOrder) {
      lines.push([
        String(bin.index),
        String(stop.order),
        csvCell(stop.sku),
        csvCell(stop.name),
        String(stop.x),
        String(stop.y),
        String(stop.z),
        String(stop.lengthCm),
        String(stop.widthCm),
        String(stop.heightCm),
        String(stop.weightKg),
      ].join(","));
    }
  }
  return `${lines.join("\n")}\n`;
}

export function unplacedLabel(reason: UnplacedReason) {
  if (reason === "too-heavy") return "Over the weight limit";
  if (reason === "limit") return "Needs more than 30 loads";
  return "Does not fit";
}

export function loadNoun(kind: "container" | "vehicle", count: number) {
  if (kind === "vehicle") return count === 1 ? "van" : "vans";
  return count === 1 ? "container" : "containers";
}

function emptyPlan(space: LoadSpaceLabel, problems: LoadProblem[]): LoadPlanView {
  return { version: 1, space, bins: [], unplaced: [], problems, containerCount: 0 };
}

function expandLines(lines: LoadLine[]) {
  const pieces: PackPiece[] = [];
  const problems: LoadProblem[] = [];
  for (const line of lines) {
    for (let copy = 1; copy <= line.qty; copy += 1) {
      pieces.push({
        id: `${line.id}#${copy}`,
        sku: line.sku,
        name: line.name,
        stackKey: `${line.sku}#${line.lengthCm}x${line.widthCm}x${line.heightCm}`,
        lengthCm: line.lengthCm,
        widthCm: line.widthCm,
        heightCm: line.heightCm,
        weightKg: line.weightKg,
        stackable: line.stackable,
        maxStack: line.maxStack,
        canBeOnSide: line.canBeOnSide,
      });
    }
  }
  return { pieces, problems };
}

function lineFrom(item: unknown, index: number): LoadLine | string {
  if (!item || typeof item !== "object") return `Row ${index + 1} is not an item.`;
  const row = item as Record<string, unknown>;
  const sku = text(row.sku, 80);
  const name = text(row.name, 200) || sku || "Item";
  if (!sku && !text(row.name, 200)) return `Row ${index + 1} needs a name.`;
  const qty = whole(row.qty, 1, MAX_QTY);
  const lengthCm = whole(row.lengthCm, 1, 2000);
  const widthCm = whole(row.widthCm, 1, 500);
  const heightCm = whole(row.heightCm, 1, 400);
  const weightKg = weight(row.weightKg);
  if (qty == null || lengthCm == null || widthCm == null || heightCm == null || weightKg == null) {
    return `${name} needs a quantity, size, and weight.`;
  }
  const maxStack = row.maxStack == null || row.maxStack === "" ? null : whole(row.maxStack, 1, 20);
  if (row.maxStack != null && row.maxStack !== "" && maxStack == null) return `${name} max stack must be from 1 to 20.`;
  const id = safeId(row.id) || `line-${index + 1}`;
  return {
    id,
    sku: sku || name.slice(0, 80),
    name,
    qty,
    lengthCm,
    widthCm,
    heightCm,
    weightKg,
    stackable: row.stackable !== false,
    maxStack,
    canBeOnSide: row.canBeOnSide === true,
  };
}

function binView(bin: PackedBin, index: number, space: UsableSpace, byId: Map<string, PackPiece>): LoadBinView {
  const used = bin.placements.reduce((sum, item) => sum + item.lengthCm * item.widthCm * item.heightCm, 0);
  const capacity = space.lengthCm * space.widthCm * space.heightCm;
  const ordered = [...bin.placements].sort((a, b) => a.x - b.x || a.z - b.z || a.y - b.y || a.id.localeCompare(b.id));
  const pieces = bin.placements.flatMap((item) => {
    const piece = byId.get(item.id);
    return piece ? [piece] : [];
  });
  return {
    index: index + 1,
    placements: bin.placements,
    goodsKg: bin.goodsKg,
    goodsHeightCm: bin.goodsHeightCm,
    volumePct: capacity > 0 ? round1((used / capacity) * 100) : 0,
    weightPct: space.maxGoodsKg > 0 ? round1((bin.goodsKg / space.maxGoodsKg) * 100) : 0,
    freeVolumeM3: round2(Math.max(0, capacity - used) / 1_000_000),
    freeKg: Math.max(0, (tenths(space.maxGoodsKg) - tenths(bin.goodsKg)) / 10),
    loadOrder: ordered.map((item, order) => ({
      order: order + 1,
      sku: item.sku,
      name: item.name,
      x: item.x,
      y: item.y,
      z: item.z,
      lengthCm: item.lengthCm,
      widthCm: item.widthCm,
      heightCm: item.heightCm,
      weightKg: item.weightKg,
    })),
    roomFor: roomFor(pieces, space),
  };
}

function roomFor(pieces: PackPiece[], space: UsableSpace): RoomFor | null {
  if (!pieces.length) return null;
  const largest = [...pieces].sort((a, b) =>
    volume(b) - volume(a) || b.weightKg - a.weightKg || a.sku.localeCompare(b.sku))[0];
  if (!largest) return null;
  const fits = (extra: number) => {
    const extras: PackPiece[] = [];
    for (let copy = 1; copy <= extra; copy += 1) extras.push({ ...largest, id: `room-extra-${copy}` });
    const packed = packPieces([...pieces, ...extras], space, 1);
    return packed.bins.length === 1 && packed.unplaced.length === 0;
  };
  if (!fits(1)) return null;
  let best = 1;
  let low = 2;
  let high = MAX_EXTRA;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return { sku: largest.sku, name: largest.name, count: best, atLeast: best === MAX_EXTRA };
}

function groupUnplaced(unplaced: Unplaced[]) {
  const groups = new Map<string, { sku: string; name: string; reason: UnplacedReason; count: number }>();
  for (const item of unplaced) {
    const key = `${item.piece.sku}#${item.reason}`;
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { sku: item.piece.sku, name: item.piece.name, reason: item.reason, count: 1 });
  }
  return [...groups.values()];
}

function complete(pack: PackageSpec) {
  return pack.lengthCm != null && pack.widthCm != null && pack.heightCm != null && pack.weightKg != null
    && pack.lengthCm >= 1 && pack.widthCm >= 1 && pack.heightCm >= 1 && pack.weightKg > 0;
}

function volume(piece: PackPiece) {
  return piece.lengthCm * piece.widthCm * piece.heightCm;
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeId(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /^[A-Za-z0-9#_-]{1,80}$/.test(trimmed) ? trimmed : "";
}

function whole(value: unknown, min: number, max: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function weight(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!(parsed > 0) || parsed > 2000) return null;
  if (Math.abs(parsed * 10 - Math.round(parsed * 10)) > 1e-6) return null;
  return round1(parsed);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function csvCell(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replaceAll("\"", "\"\"")}"`;
  return value;
}
