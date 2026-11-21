import { describe, expect, it } from "vitest";
import { priceInstall } from "@/lib/pricer/engine";
import { loadBundledEffortTable } from "@/lib/pricer/effort-table";

const table = loadBundledEffortTable();

describe("blank postcode", () => {
  it("blocks instead of pricing travel", () => {
    const result = priceInstall({
      mode: "A",
      postcode: "",
      segment: "independent",
      lines: [{ productName: "FID Bench", qty: 1 }],
      table,
    });
    expect(result.blockedReason).toBe("Enter the postcode.");
    expect(result.cost).toBeNull();
    expect(result.customerPrice).toBeNull();
    expect(result.miles).toBeNull();
    expect(result.breakdown).toBeNull();
  });

  it("still prices when miles were supplied with the request", () => {
    const result = priceInstall({
      mode: "A",
      postcode: "",
      miles: 15,
      segment: "independent",
      lines: [{ productName: "FID Bench", qty: 1 }],
      table,
    });
    expect(result.blockedReason).toBeNull();
    expect(result.cost).not.toBeNull();
  });
});
