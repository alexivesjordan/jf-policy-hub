import { describe, expect, it } from "vitest";
import { packingListFromCsv } from "./csv";
import { linesFromPackingRows } from "./load-plan";
import { spaceCodeFromName, validSpaceCode } from "./space-code";
import { readLoadSpace } from "./space-input";

describe("supplier packing list", () => {
  it("reads sku, qty, and size aliases", () => {
    const parsed = packingListFromCsv("sku,qty,L,W,H,kg,name\nRACK,2,140,120,210,160,Power rack\n");
    expect(parsed.error).toBe("");
    expect(parsed.rows).toEqual([{
      sku: "RACK",
      name: "Power rack",
      qty: 2,
      lengthCm: 140,
      widthCm: 120,
      heightCm: 210,
      weightKg: 160,
    }]);
    expect(linesFromPackingRows(parsed.rows)[0]?.id).toBe("csv-1-RACK");
  });

  it("accepts the packaging column names and a default quantity", () => {
    const parsed = packingListFromCsv("SKU,length_cm,width_cm,height_cm,gross_weight_kg\nPLATE,40,40,20,20.5\n");
    expect(parsed.error).toBe("");
    expect(parsed.rows[0]).toMatchObject({ sku: "PLATE", qty: 1, weightKg: 20.5 });
  });

  it("rejects a list without sizes or with a bad weight", () => {
    expect(packingListFromCsv("sku,qty\nRACK,1\n").error).toMatch(/length, width, height, and weight/);
    expect(packingListFromCsv("sku,L,W,H,kg\nRACK,10,10,10,1.25\n").error).toMatch(/one decimal/);
    expect(packingListFromCsv("sku,L,W,H,kg\nRACK,10,10,10,\n").error).toMatch(/weight is required/);
    expect(packingListFromCsv("").error).toMatch(/sku column/);
  });

  it("makes a load space code from a name", () => {
    expect(spaceCodeFromName("Jordan LWB van")).toBe("jordan-lwb-van");
    expect(validSpaceCode("van-lwb")).toBe(true);
    expect(validSpaceCode("Van")).toBe(false);
    expect(validSpaceCode("")).toBe(false);
  });

  it("checks measured interior dimensions", () => {
    const parsed = readLoadSpace({ code: "van-jordan", name: "Jordan van", kind: "vehicle", lengthCm: "410", widthCm: "170", heightCm: "175", maxWeightKg: "1100" });
    expect(parsed.ok).toBe(true);
    expect(readLoadSpace({ code: "Van", name: "Jordan van", kind: "pallet", lengthCm: "1", widthCm: "1", heightCm: "1", maxWeightKg: "1" }).ok).toBe(false);
  });
});
