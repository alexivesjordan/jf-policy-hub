import { describe, expect, it } from "vitest";
import {
  collectLoadLines,
  linesFromPackages,
  loadPlanCsv,
  planLoad,
  reopenPlan,
  type LoadLine,
  type LoadPlanView,
} from "./load-plan";
import type { PackageSpec, UsableSpace } from "./types";

const container: UsableSpace = { lengthCm: 590, widthCm: 235, heightCm: 239, maxGoodsKg: 21700 };
const label = {
  code: "container-20dc",
  name: "20ft dry",
  kind: "container" as const,
  lengthCm: 590,
  widthCm: 235,
  heightCm: 239,
  maxGoodsKg: 21700,
};

function line(partial: Partial<LoadLine> & Pick<LoadLine, "id" | "sku" | "lengthCm" | "widthCm" | "heightCm" | "weightKg">): LoadLine {
  return {
    name: partial.name ?? partial.sku,
    qty: partial.qty ?? 1,
    stackable: partial.stackable ?? true,
    maxStack: partial.maxStack ?? null,
    canBeOnSide: partial.canBeOnSide ?? false,
    ...partial,
  };
}

function assertPacked(plan: LoadPlanView, space: UsableSpace) {
  expect(plan.containerCount).toBe(plan.bins.length);
  for (const bin of plan.bins) {
    let tenths = 0;
    let used = 0;
    for (const item of bin.placements) {
      expect(item.x).toBeGreaterThanOrEqual(0);
      expect(item.y).toBeGreaterThanOrEqual(0);
      expect(item.z).toBeGreaterThanOrEqual(0);
      expect(item.x + item.lengthCm).toBeLessThanOrEqual(space.lengthCm);
      expect(item.y + item.widthCm).toBeLessThanOrEqual(space.widthCm);
      expect(item.z + item.heightCm).toBeLessThanOrEqual(space.heightCm);
      tenths += Math.round(item.weightKg * 10);
      used += item.lengthCm * item.widthCm * item.heightCm;
    }
    expect(tenths).toBeLessThanOrEqual(Math.round(space.maxGoodsKg * 10));
    expect(bin.weightPct).toBeLessThanOrEqual(100);
    expect(bin.volumePct).toBeLessThanOrEqual(100);
    expect(bin.freeKg).toBeGreaterThanOrEqual(0);
    const capacity = space.lengthCm * space.widthCm * space.heightCm;
    expect(bin.freeVolumeM3).toBeCloseTo(Math.max(0, capacity - used) / 1_000_000, 2);
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
    const orders = bin.loadOrder.map((stop) => stop.order);
    expect(orders).toEqual(orders.map((_, index) => index + 1));
    for (let index = 1; index < bin.loadOrder.length; index += 1) {
      const previous = bin.loadOrder[index - 1]!;
      const next = bin.loadOrder[index]!;
      const backFirst = previous.x < next.x
        || (previous.x === next.x && previous.z < next.z)
        || (previous.x === next.x && previous.z === next.z && previous.y <= next.y);
      expect(backFirst).toBe(true);
    }
  }
}

describe("container load plan", () => {
  it("packs a mixed 20ft of racks, benches, and plates inside the interior", () => {
    const plan = planLoad([
      line({ id: "rack", sku: "RACK", name: "Power rack", qty: 4, lengthCm: 140, widthCm: 120, heightCm: 210, weightKg: 160, stackable: false }),
      line({ id: "bench", sku: "BENCH", name: "Bench", qty: 4, lengthCm: 130, widthCm: 55, heightCm: 45, weightKg: 42 }),
      line({ id: "plate", sku: "PLATE", name: "Plate box", qty: 8, lengthCm: 40, widthCm: 40, heightCm: 20, weightKg: 20 }),
    ], container, label);
    expect(plan.unplaced).toEqual([]);
    expect(plan.problems).toEqual([]);
    expect(plan.containerCount).toBe(1);
    expect(plan.bins[0]?.placements).toHaveLength(16);
    assertPacked(plan, container);
    expect(plan.bins[0]?.volumePct).toBeGreaterThan(0);
    expect(plan.bins[0]?.weightPct).toBeGreaterThan(0);
    expect(plan.bins[0]?.weightPct).toBeLessThan(100);
  });

  it("splits into another container when the cargo is over capacity", () => {
    const plan = planLoad([
      line({ id: "bulk", sku: "BULK", qty: 3, lengthCm: 400, widthCm: 200, heightCm: 200, weightKg: 80 }),
    ], container, label);
    expect(plan.unplaced).toEqual([]);
    expect(plan.containerCount).toBe(3);
    expect(plan.bins.every((bin) => bin.placements.length === 1)).toBe(true);
    assertPacked(plan, container);
  });

  it("respects the weight limit", () => {
    const light: UsableSpace = { lengthCm: 590, widthCm: 235, heightCm: 239, maxGoodsKg: 100 };
    const plan = planLoad([
      line({ id: "a", sku: "CRATE", qty: 3, lengthCm: 40, widthCm: 40, heightCm: 40, weightKg: 40 }),
    ], light, { ...label, maxGoodsKg: 100 });
    expect(plan.unplaced).toEqual([]);
    expect(plan.containerCount).toBe(2);
    expect(plan.bins.map((bin) => bin.goodsKg).sort()).toEqual([40, 80]);
    assertPacked(plan, light);
  });

  it("leaves a too-heavy piece unplaced", () => {
    const plan = planLoad([
      line({ id: "a", sku: "HEAVY", lengthCm: 40, widthCm: 40, heightCm: 40, weightKg: 500 }),
    ], { ...container, maxGoodsKg: 100 }, { ...label, maxGoodsKg: 100 });
    expect(plan.containerCount).toBe(0);
    expect(plan.unplaced).toEqual([{ sku: "HEAVY", name: "HEAVY", reason: "too-heavy", count: 1 }]);
  });

  it("estimates room for more of the largest placed item", () => {
    const plan = planLoad([
      line({ id: "one", sku: "CUBE", name: "Cube", lengthCm: 50, widthCm: 50, heightCm: 50, weightKg: 10 }),
    ], container, label);
    expect(plan.containerCount).toBe(1);
    expect(plan.bins[0]?.roomFor?.sku).toBe("CUBE");
    expect(plan.bins[0]?.roomFor?.count).toBeGreaterThanOrEqual(10);
    assertPacked(plan, container);
  });

  it("does not offer more of an item that already fills the container", () => {
    const plan = planLoad([
      line({ id: "full", sku: "FULL", lengthCm: 590, widthCm: 235, heightCm: 239, weightKg: 100 }),
    ], container, label);
    expect(plan.containerCount).toBe(1);
    expect(plan.bins[0]?.roomFor).toBeNull();
  });

  it("reopens a saved snapshot identically", () => {
    const lines = [
      line({ id: "rack", sku: "RACK", qty: 2, lengthCm: 140, widthCm: 120, heightCm: 210, weightKg: 160, stackable: false }),
      line({ id: "plate", sku: "PLATE", qty: 3, lengthCm: 40, widthCm: 40, heightCm: 20, weightKg: 20 }),
    ];
    const plan = planLoad(lines, container, label);
    const saved = JSON.parse(JSON.stringify({ pieces: lines, summary: plan })) as { pieces: unknown; summary: unknown };
    expect(collectLoadLines(saved.pieces).lines).toEqual(lines);
    expect(reopenPlan(saved.summary)).toEqual(plan);
    expect(planLoad(lines, container, label)).toEqual(plan);
    expect(loadPlanCsv(plan).split("\n")[0]).toBe("container,load_order,sku,name,from_back_cm,from_left_cm,from_floor_cm,length_cm,width_cm,height_cm,kg");
  });

  it("turns catalogue packages into one line per box", () => {
    const packs: PackageSpec[] = [{
      sku: "BENCH",
      name: "Bench",
      packageNo: 1,
      lengthCm: 130,
      widthCm: 55,
      heightCm: 45,
      weightKg: 42,
      stackable: true,
      maxStack: null,
      canBeOnSide: false,
      palletOnly: false,
    }];
    const built = linesFromPackages([{ sku: "BENCH", name: "Bench", qty: 2 }], packs);
    expect(built.problems).toEqual([]);
    expect(built.lines).toHaveLength(1);
    expect(built.lines[0]?.qty).toBe(2);
    const missing = linesFromPackages([{ sku: "RACK", name: "Rack", qty: 1 }], []);
    expect(missing.lines).toEqual([]);
    expect(missing.problems[0]?.message).toBe("RACK has no packaging.");
  });
});
