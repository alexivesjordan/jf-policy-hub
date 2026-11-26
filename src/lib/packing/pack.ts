import { round1, tenths } from "./space";
import type { PackedBin, PackPiece, Placement, Unplaced, UsableSpace } from "./types";

type Point = { x: number; y: number; z: number };
type Orientation = { lengthCm: number; widthCm: number; heightCm: number };

const AXES = [
  [0, 1, 2],
  [1, 0, 2],
  [0, 2, 1],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
] as const;

type Bin = {
  placements: Placement[];
  goodsTenths: number;
  points: Point[];
  pointKeys: Set<string>;
};

/**
 * Extreme-point, first-fit decreasing packer.
 * It fills the floor before it stacks, keeps every box inside the footprint,
 * and does not hang a box over empty space. It is a heuristic, not an optimum.
 * `space` is the clear interior: the caller has already removed deck and tare.
 */
export function packPieces(pieces: PackPiece[], space: UsableSpace, maxBins = 30): { bins: PackedBin[]; unplaced: Unplaced[] } {
  const ordered = [...pieces].sort((a, b) =>
    volume(b) - volume(a)
    || Math.max(b.lengthCm, b.widthCm, b.heightCm) - Math.max(a.lengthCm, a.widthCm, a.heightCm)
    || tenths(b.weightKg) - tenths(a.weightKg)
    || a.id.localeCompare(b.id));
  const bins: Bin[] = [];
  const unplaced: Unplaced[] = [];

  for (const piece of ordered) {
    if (!positive(piece)) {
      unplaced.push({ piece, reason: "too-large" });
      continue;
    }
    const emptyFit = fitsEmpty(piece, space);
    if (!emptyFit.ok) {
      unplaced.push({ piece, reason: emptyFit.reason });
      continue;
    }
    let placed = false;
    for (const bin of bins) {
      if (placeInBin(bin, piece, space)) {
        placed = true;
        break;
      }
    }
    if (placed) continue;
    if (bins.length >= maxBins) {
      unplaced.push({ piece, reason: "limit" });
      continue;
    }
    const bin = emptyBin();
    if (!placeInBin(bin, piece, space)) {
      unplaced.push({ piece, reason: "too-large" });
      continue;
    }
    bins.push(bin);
  }

  return {
    bins: bins.map((bin) => ({
      placements: bin.placements,
      goodsKg: bin.goodsTenths / 10,
      goodsHeightCm: bin.placements.reduce((height, item) => Math.max(height, item.z + item.heightCm), 0),
    })),
    unplaced,
  };
}

function volume(piece: PackPiece) {
  return piece.lengthCm * piece.widthCm * piece.heightCm;
}

function positive(piece: PackPiece) {
  return piece.lengthCm >= 1 && piece.widthCm >= 1 && piece.heightCm >= 1 && piece.weightKg > 0;
}

function fitsEmpty(piece: PackPiece, space: UsableSpace): { ok: true } | { ok: false; reason: "too-large" | "too-heavy" } {
  const spatial = orientations(piece).some((orientation) =>
    orientation.lengthCm <= space.lengthCm
    && orientation.widthCm <= space.widthCm
    && orientation.heightCm <= space.heightCm);
  const weightOk = tenths(piece.weightKg) <= tenths(space.maxGoodsKg);
  if (!spatial) return { ok: false, reason: "too-large" };
  if (!weightOk) return { ok: false, reason: "too-heavy" };
  return { ok: true };
}

function orientations(piece: PackPiece): Orientation[] {
  const dims = [piece.lengthCm, piece.widthCm, piece.heightCm];
  const allowed = piece.canBeOnSide ? AXES : AXES.slice(0, 2);
  const seen = new Set<string>();
  const list: Orientation[] = [];
  for (const [x, y, z] of allowed) {
    const orientation = { lengthCm: dims[x]!, widthCm: dims[y]!, heightCm: dims[z]! };
    const key = `${orientation.lengthCm}x${orientation.widthCm}x${orientation.heightCm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(orientation);
  }
  list.sort((a, b) => a.heightCm - b.heightCm || a.lengthCm - b.lengthCm || a.widthCm - b.widthCm);
  return list;
}

function emptyBin(): Bin {
  return {
    placements: [],
    goodsTenths: 0,
    points: [{ x: 0, y: 0, z: 0 }],
    pointKeys: new Set(["0,0,0"]),
  };
}

function placeInBin(bin: Bin, piece: PackPiece, space: UsableSpace) {
  if (bin.goodsTenths + tenths(piece.weightKg) > tenths(space.maxGoodsKg)) return false;
  const points = [...bin.points].sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
  for (const point of points) {
    for (const orientation of orientations(piece)) {
      const candidate: Placement = {
        id: piece.id,
        sku: piece.sku,
        name: piece.name,
        stackKey: piece.stackKey,
        x: point.x,
        y: point.y,
        z: point.z,
        lengthCm: orientation.lengthCm,
        widthCm: orientation.widthCm,
        heightCm: orientation.heightCm,
        weightKg: round1(piece.weightKg),
        stackable: piece.stackable,
      };
      if (!within(candidate, space)) continue;
      if (bin.placements.some((item) => intersects(item, candidate))) continue;
      if (!supported(candidate, bin.placements)) continue;
      if (!stackAllowed(candidate, piece, bin.placements)) continue;
      bin.placements.push(candidate);
      bin.goodsTenths += tenths(piece.weightKg);
      addPoints(bin, candidate, space);
      return true;
    }
  }
  return false;
}

function within(item: Placement, space: UsableSpace) {
  return item.x >= 0 && item.y >= 0 && item.z >= 0
    && item.x + item.lengthCm <= space.lengthCm
    && item.y + item.widthCm <= space.widthCm
    && item.z + item.heightCm <= space.heightCm;
}

function intersects(a: Placement, b: Placement) {
  return a.x < b.x + b.lengthCm && b.x < a.x + a.lengthCm
    && a.y < b.y + b.widthCm && b.y < a.y + a.widthCm
    && a.z < b.z + b.heightCm && b.z < a.z + a.heightCm;
}

function overlapArea(a: Placement, b: Placement) {
  const width = Math.min(a.x + a.lengthCm, b.x + b.lengthCm) - Math.max(a.x, b.x);
  const depth = Math.min(a.y + a.widthCm, b.y + b.widthCm) - Math.max(a.y, b.y);
  if (width <= 0 || depth <= 0) return 0;
  return width * depth;
}

function supported(candidate: Placement, placed: Placement[]) {
  if (candidate.z === 0) return true;
  const need = candidate.lengthCm * candidate.widthCm;
  let covered = 0;
  for (const item of placed) {
    if (item.z + item.heightCm !== candidate.z) continue;
    const area = overlapArea(candidate, item);
    if (area <= 0) continue;
    if (!item.stackable) return false;
    covered += area;
  }
  return covered >= need;
}

function stackAllowed(candidate: Placement, piece: PackPiece, placed: Placement[]) {
  if (piece.maxStack == null) return true;
  let count = 0;
  for (const item of placed) {
    if (item.stackKey !== piece.stackKey) continue;
    if (overlapArea(candidate, item) > 0) count += 1;
  }
  return count + 1 <= piece.maxStack;
}

function addPoints(bin: Bin, placed: Placement, space: UsableSpace) {
  const next = [
    { x: placed.x + placed.lengthCm, y: placed.y, z: placed.z },
    { x: placed.x, y: placed.y + placed.widthCm, z: placed.z },
    { x: placed.x, y: placed.y, z: placed.z + placed.heightCm },
  ];
  for (const point of next) {
    if (point.x >= space.lengthCm || point.y >= space.widthCm || point.z >= space.heightCm) continue;
    if (point.x < 0 || point.y < 0 || point.z < 0) continue;
    const key = `${point.x},${point.y},${point.z}`;
    if (bin.pointKeys.has(key)) continue;
    bin.pointKeys.add(key);
    bin.points.push(point);
  }
}
