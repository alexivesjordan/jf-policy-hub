import { describe, expect, it } from "vitest";
import { packPieces } from "./pack";
import type { PackedBin, PackPiece, UsableSpace } from "./types";

const pallet: UsableSpace = { lengthCm: 120, widthCm: 100, heightCm: 165, maxGoodsKg: 975 };

function piece(partial: Partial<PackPiece> & Pick<PackPiece, "id" | "lengthCm" | "widthCm" | "heightCm" | "weightKg">): PackPiece {
  return {
    sku: partial.sku ?? "JF-1",
    name: partial.name ?? "Item",
    stackKey: partial.stackKey ?? partial.sku ?? "JF-1",
    stackable: partial.stackable ?? true,
    maxStack: partial.maxStack ?? null,
    canBeOnSide: partial.canBeOnSide ?? false,
    ...partial,
  };
}

function assertInside(bins: PackedBin[], space: UsableSpace) {
  for (const bin of bins) {
    let tenths = 0;
    for (const item of bin.placements) {
      expect(item.x).toBeGreaterThanOrEqual(0);
      expect(item.y).toBeGreaterThanOrEqual(0);
      expect(item.z).toBeGreaterThanOrEqual(0);
      expect(item.x + item.lengthCm).toBeLessThanOrEqual(space.lengthCm);
      expect(item.y + item.widthCm).toBeLessThanOrEqual(space.widthCm);
      expect(item.z + item.heightCm).toBeLessThanOrEqual(space.heightCm);
      tenths += Math.round(item.weightKg * 10);
      if (item.z > 0) {
        const supporters = bin.placements.filter((other) => other.z + other.heightCm === item.z);
        let covered = 0;
        for (const other of supporters) {
          const width = Math.min(item.x + item.lengthCm, other.x + other.lengthCm) - Math.max(item.x, other.x);
          const depth = Math.min(item.y + item.widthCm, other.y + other.widthCm) - Math.max(item.y, other.y);
          if (width > 0 && depth > 0) {
            expect(other.stackable).toBe(true);
            covered += width * depth;
          }
        }
        expect(covered).toBeGreaterThanOrEqual(item.lengthCm * item.widthCm);
      }
    }
    expect(tenths).toBeLessThanOrEqual(Math.round(space.maxGoodsKg * 10));
    for (let left = 0; left < bin.placements.length; left += 1) {
      for (let right = left + 1; right < bin.placements.length; right += 1) {
        const a = bin.placements[left]!;
        const b = bin.placements[right]!;
        const overlap = a.x < b.x + b.lengthCm && b.x < a.x + a.lengthCm
          && a.y < b.y + b.widthCm && b.y < a.y + a.widthCm
          && a.z < b.z + b.heightCm && b.z < a.z + a.heightCm;
        expect(overlap).toBe(false);
      }
    }
  }
}

describe("pallet packer", () => {
  it("puts two boxes side by side on the floor", () => {
    const result = packPieces([
      piece({ id: "a", lengthCm: 50, widthCm: 40, heightCm: 30, weightKg: 10 }),
      piece({ id: "b", lengthCm: 50, widthCm: 40, heightCm: 30, weightKg: 10 }),
    ], pallet);
    expect(result.unplaced).toEqual([]);
    expect(result.bins).toHaveLength(1);
    expect(result.bins[0]?.placements.every((item) => item.z === 0)).toBe(true);
    assertInside(result.bins, pallet);
  });

  it("stacks when the footprint is full and the box is stackable", () => {
    const tight: UsableSpace = { lengthCm: 100, widthCm: 100, heightCm: 120, maxGoodsKg: 500 };
    const result = packPieces([
      piece({ id: "a", lengthCm: 80, widthCm: 80, heightCm: 40, weightKg: 20 }),
      piece({ id: "b", lengthCm: 80, widthCm: 80, heightCm: 40, weightKg: 20 }),
    ], tight);
    expect(result.bins).toHaveLength(1);
    expect(result.bins[0]?.placements.map((item) => item.z).sort()).toEqual([0, 40]);
    assertInside(result.bins, tight);
  });

  it("opens another pallet when the box cannot be stacked", () => {
    const tight: UsableSpace = { lengthCm: 100, widthCm: 100, heightCm: 120, maxGoodsKg: 500 };
    const result = packPieces([
      piece({ id: "a", lengthCm: 80, widthCm: 80, heightCm: 40, weightKg: 20, stackable: false }),
      piece({ id: "b", lengthCm: 80, widthCm: 80, heightCm: 40, weightKg: 20, stackable: false }),
    ], tight);
    expect(result.bins).toHaveLength(2);
    expect(result.bins.every((bin) => bin.placements.length === 1 && bin.placements[0]?.z === 0)).toBe(true);
  });

  it("honours a max stack of one", () => {
    const tight: UsableSpace = { lengthCm: 100, widthCm: 100, heightCm: 200, maxGoodsKg: 500 };
    const result = packPieces([
      piece({ id: "a", stackKey: "same", lengthCm: 80, widthCm: 80, heightCm: 40, weightKg: 10, maxStack: 1 }),
      piece({ id: "b", stackKey: "same", lengthCm: 80, widthCm: 80, heightCm: 40, weightKg: 10, maxStack: 1 }),
    ], tight);
    expect(result.bins).toHaveLength(2);
  });

  it("splits pallets on gross goods weight", () => {
    const light: UsableSpace = { lengthCm: 120, widthCm: 100, heightCm: 165, maxGoodsKg: 100 };
    const result = packPieces([
      piece({ id: "a", lengthCm: 40, widthCm: 40, heightCm: 40, weightKg: 40 }),
      piece({ id: "b", lengthCm: 40, widthCm: 40, heightCm: 40, weightKg: 40 }),
      piece({ id: "c", lengthCm: 40, widthCm: 40, heightCm: 40, weightKg: 40 }),
    ], light);
    expect(result.bins).toHaveLength(2);
    expect(result.bins.map((bin) => bin.goodsKg).sort()).toEqual([40, 80]);
    assertInside(result.bins, light);
  });

  it("rejects a box that is heavier than an empty pallet", () => {
    const result = packPieces([
      piece({ id: "a", lengthCm: 40, widthCm: 40, heightCm: 40, weightKg: 980 }),
    ], pallet);
    expect(result.bins).toEqual([]);
    expect(result.unplaced.map((item) => item.reason)).toEqual(["too-heavy"]);
  });

  it("rejects a box that cannot fit in any orientation", () => {
    const result = packPieces([
      piece({ id: "a", lengthCm: 200, widthCm: 40, heightCm: 30, weightKg: 10, canBeOnSide: true }),
    ], pallet);
    expect(result.unplaced.map((item) => item.reason)).toEqual(["too-large"]);
  });

  it("lays a box on its side only when that is allowed", () => {
    const low: UsableSpace = { lengthCm: 120, widthCm: 100, heightCm: 50, maxGoodsKg: 500 };
    const tall = { lengthCm: 90, widthCm: 40, heightCm: 80, weightKg: 12 };
    const upright = packPieces([piece({ id: "a", ...tall })], low);
    expect(upright.unplaced.map((item) => item.reason)).toEqual(["too-large"]);
    const onSide = packPieces([piece({ id: "a", ...tall, canBeOnSide: true })], low);
    expect(onSide.unplaced).toEqual([]);
    expect(onSide.bins[0]?.placements[0]?.heightCm).toBe(40);
    assertInside(onSide.bins, low);
  });

  it("is deterministic", () => {
    const pieces = [
      piece({ id: "b", sku: "JF-B", lengthCm: 60, widthCm: 40, heightCm: 30, weightKg: 8 }),
      piece({ id: "a", sku: "JF-A", lengthCm: 70, widthCm: 50, heightCm: 40, weightKg: 15 }),
    ];
    expect(packPieces(pieces, pallet)).toEqual(packPieces(pieces, pallet));
  });
});
