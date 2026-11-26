import type { LoadSpace, UsableSpace } from "./types";

export function round1(value: number) {
  return Math.round(value * 10) / 10;
}

export function tenths(kg: number) {
  return Math.round(kg * 10);
}

/**
 * Turns a stored load space into the clear interior the packer fills.
 * Pallet overrides replace the catalogue height and gross weight.
 * Tare and deck stay on the space, so the same call works for a container later.
 */
export function usableInterior(
  space: LoadSpace,
  overrides?: { maxHeightCm?: number; maxGrossKg?: number },
): UsableSpace {
  const maxHeight = overrides?.maxHeightCm ?? space.heightCm;
  const maxGross = overrides?.maxGrossKg ?? space.maxWeightKg;
  return {
    lengthCm: space.lengthCm,
    widthCm: space.widthCm,
    heightCm: maxHeight - space.deckCm,
    maxGoodsKg: round1(maxGross - space.tareKg),
  };
}
