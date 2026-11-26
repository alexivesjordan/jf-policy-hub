import { describe, expect, it } from "vitest";
import { packagesFromCsv, packagesToCsv } from "./csv";
import { estimateShipment } from "./estimate";
import { usableInterior } from "./space";
import type { LoadSpace, PackageSpec } from "./types";

const uk: LoadSpace = {
  code: "uk-standard",
  kind: "pallet",
  lengthCm: 120,
  widthCm: 100,
  heightCm: 180,
  maxWeightKg: 1000,
  deckCm: 15,
  tareKg: 25,
};

function pack(partial: Partial<PackageSpec> & Pick<PackageSpec, "sku">): PackageSpec {
  return {
    name: partial.name ?? partial.sku,
    packageNo: partial.packageNo ?? 1,
    lengthCm: partial.lengthCm === undefined ? 40 : partial.lengthCm,
    widthCm: partial.widthCm === undefined ? 30 : partial.widthCm,
    heightCm: partial.heightCm === undefined ? 20 : partial.heightCm,
    weightKg: partial.weightKg === undefined ? 8 : partial.weightKg,
    stackable: partial.stackable ?? true,
    maxStack: partial.maxStack ?? null,
    canBeOnSide: partial.canBeOnSide ?? false,
    palletOnly: partial.palletOnly ?? false,
    sku: partial.sku,
  };
}

const limits = { space: uk, maxHeightCm: 180, maxGrossKg: 1000, maxParcelWeightKg: 30, maxParcelLengthCm: 120 };

describe("shipment estimate", () => {
  it("counts a courier-sized box as a parcel and does not build a pallet", () => {
    const result = estimateShipment({
      ...limits,
      lines: [{ sku: "JF-1", name: "Band", qty: 3 }],
      packages: [pack({ sku: "JF-1", weightKg: 8, lengthCm: 40, widthCm: 30, heightCm: 20 })],
    });
    expect(result.parcelCount).toBe(3);
    expect(result.palletCount).toBe(0);
    expect(result.readyForInvoice).toBe(true);
    expect(result.invoiceRows).toEqual([
      { kind: "parcel", lengthCm: 40, widthCm: 30, depthCm: 20, weightKg: 8 },
      { kind: "parcel", lengthCm: 40, widthCm: 30, depthCm: 20, weightKg: 8 },
      { kind: "parcel", lengthCm: 40, widthCm: 30, depthCm: 20, weightKg: 8 },
    ]);
  });

  it("sends an overweight, over-length, or pallet-only box onto a pallet", () => {
    const result = estimateShipment({
      ...limits,
      lines: [
        { sku: "HEAVY", name: "Heavy", qty: 1 },
        { sku: "LONG", name: "Long", qty: 1 },
        { sku: "ONLY", name: "Only", qty: 1 },
      ],
      packages: [
        pack({ sku: "HEAVY", weightKg: 40, lengthCm: 50, widthCm: 40, heightCm: 30 }),
        pack({ sku: "LONG", weightKg: 10, lengthCm: 130, widthCm: 20, heightCm: 20, canBeOnSide: true }),
        pack({ sku: "ONLY", weightKg: 5, lengthCm: 30, widthCm: 20, heightCm: 10, palletOnly: true }),
      ],
    });
    expect(result.parcelCount).toBe(0);
    expect(result.palletCount).toBe(1);
    expect(result.unfit).toEqual([]);
    expect(result.pallets[0]).toMatchObject({ lengthCm: 120, widthCm: 100, totalHeightCm: 145, grossKg: 80 });
    expect(result.invoiceRows[0]).toMatchObject({ kind: "pallet", lengthCm: 120, widthCm: 100, depthCm: 145, weightKg: 80 });
  });

  it("flags a missing package and still packs the complete one", () => {
    const result = estimateShipment({
      ...limits,
      lines: [{ sku: "JF-2", name: "Rack", qty: 1 }],
      packages: [
        pack({ sku: "JF-2", packageNo: 1, weightKg: 40, lengthCm: 80, widthCm: 40, heightCm: 30 }),
        pack({ sku: "JF-2", packageNo: 2, lengthCm: null, widthCm: 10, heightCm: 10, weightKg: null }),
      ],
    });
    expect(result.missing.map((flag) => flag.message)).toEqual(["JF-2 box 2 has no dimensions."]);
    expect(result.palletCount).toBe(1);
    expect(result.readyForInvoice).toBe(false);
    expect(result.invoiceRows).toEqual([]);
  });

  it("does not guess a SKU with no packaging, a fractional quantity, or an unknown line", () => {
    const result = estimateShipment({
      ...limits,
      lines: [
        { sku: "GONE", name: "Gone", qty: 1 },
        { sku: "HALF", name: "Half", qty: 1.5 },
        { sku: "", name: "Loose", qty: 1 },
      ],
      packages: [],
    });
    expect(result.parcelCount).toBe(0);
    expect(result.palletCount).toBe(0);
    expect(result.missing.map((flag) => flag.message)).toEqual([
      "GONE has no packaging.",
      "HALF quantity is not a whole number.",
      "Loose has no SKU.",
    ]);
  });

  it("expands every package on the SKU by the quantity", () => {
    const result = estimateShipment({
      ...limits,
      lines: [{ sku: "KIT", name: "Kit", qty: 2 }],
      packages: [
        pack({ sku: "KIT", packageNo: 1, weightKg: 4, lengthCm: 20, widthCm: 20, heightCm: 20 }),
        pack({ sku: "KIT", packageNo: 2, weightKg: 5, lengthCm: 25, widthCm: 20, heightCm: 15 }),
      ],
    });
    expect(result.parcelCount).toBe(4);
    expect(result.parcels.map((group) => [group.packageNo, group.count])).toEqual([[1, 2], [2, 2]]);
  });

  it("includes the pallet deck and tare in the invoice row", () => {
    const result = estimateShipment({
      ...limits,
      lines: [{ sku: "BASE", name: "Base", qty: 1 }],
      packages: [pack({ sku: "BASE", palletOnly: true, weightKg: 10, lengthCm: 40, widthCm: 40, heightCm: 20 })],
    });
    expect(result.pallets[0]?.goodsHeightCm).toBe(20);
    expect(result.pallets[0]?.totalHeightCm).toBe(35);
    expect(result.pallets[0]?.grossKg).toBe(35);
  });

  it("refuses the invoice handoff when the rows would pass 30", () => {
    const result = estimateShipment({
      ...limits,
      lines: [{ sku: "MANY", name: "Many", qty: 31 }],
      packages: [pack({ sku: "MANY" })],
    });
    expect(result.parcelCount).toBe(31);
    expect(result.readyForInvoice).toBe(false);
    expect(result.blockReason).toBe("Commercial invoices hold 30 rows.");
  });

  it("uses the same interior maths for a container with no deck", () => {
    const container: LoadSpace = {
      code: "container-20dc",
      kind: "container",
      lengthCm: 590,
      widthCm: 235,
      heightCm: 239,
      maxWeightKg: 21700,
      deckCm: 0,
      tareKg: 0,
    };
    expect(usableInterior(container)).toEqual({ lengthCm: 590, widthCm: 235, heightCm: 239, maxGoodsKg: 21700 });
    expect(usableInterior(uk, { maxHeightCm: 220, maxGrossKg: 800 })).toEqual({
      lengthCm: 120,
      widthCm: 100,
      heightCm: 205,
      maxGoodsKg: 775,
    });
  });
});

describe("packaging csv", () => {
  it("round-trips a package row", () => {
    const csv = packagesToCsv([{
      sku: "JF-1",
      product_name: "Bench, black",
      package_no: 2,
      length_cm: 110,
      width_cm: 40,
      height_cm: 25,
      gross_weight_kg: 48.5,
      stackable: true,
      max_stack: 3,
      can_be_on_side: false,
      ships_on_pallet_only: true,
    }]);
    expect(packagesFromCsv(csv).rows).toEqual([{
      sku: "JF-1",
      product_name: "Bench, black",
      package_no: 2,
      length_cm: 110,
      width_cm: 40,
      height_cm: 25,
      gross_weight_kg: 48.5,
      stackable: true,
      max_stack: 3,
      can_be_on_side: false,
      ships_on_pallet_only: true,
    }]);
  });

  it("rejects a weight with two decimals and a repeated box", () => {
    expect(packagesFromCsv("sku,gross_weight_kg\nJF-1,10.25\n").error).toMatch(/one decimal/);
    expect(packagesFromCsv("sku,package_no\nJF-1,1\nJF-1,1\n").error).toMatch(/repeated/);
  });
});
