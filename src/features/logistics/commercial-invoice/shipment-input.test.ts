import { describe, expect, it } from "vitest";
import { shipmentSchema } from "./shipment-input";

describe("shipment input limits", () => {
  it("accepts an ISO despatch date and a real email", () => {
    expect(shipmentSchema.safeParse({ despatchDate: "2026-11-21", contactEmail: "alex@jordanfitness.com" }).success).toBe(true);
    expect(shipmentSchema.safeParse({ despatchDate: "", contactEmail: "" }).success).toBe(true);
  });

  it("rejects a bad date, a bad email and values above the caps", () => {
    expect(shipmentSchema.safeParse({ despatchDate: "2026-02-31" }).success).toBe(false);
    expect(shipmentSchema.safeParse({ despatchDate: "19/11/2026" }).success).toBe(false);
    expect(shipmentSchema.safeParse({ contactEmail: "not-an-email" }).success).toBe(false);
    expect(shipmentSchema.safeParse({ deliveryPence: 100_000_001 }).success).toBe(false);
    expect(shipmentSchema.safeParse({ surchargePence: 100_000_000 }).success).toBe(true);
    expect(shipmentSchema.safeParse({ vatPence: 100_000_000 }).success).toBe(true);
    expect(shipmentSchema.safeParse({ parcels: 1000 }).success).toBe(false);
    expect(shipmentSchema.safeParse({ pallets: 999 }).success).toBe(true);
    expect(shipmentSchema.safeParse({ dimensions: [{ lengthCm: 1001, widthCm: 1, heightCm: 1, weightKg: 1 }] }).success).toBe(false);
    expect(shipmentSchema.safeParse({ dimensions: [{ lengthCm: 1000, widthCm: 1, heightCm: 1, weightKg: 5000 }] }).success).toBe(true);
    expect(shipmentSchema.safeParse({ dimensions: Array.from({ length: 41 }, () => ({ lengthCm: 1, widthCm: 1, heightCm: 1, weightKg: 1 })) }).success).toBe(false);
    expect(shipmentSchema.safeParse({ grossWeightKg: 100000 }).success).toBe(true);
    expect(shipmentSchema.safeParse({ grossWeightKg: 100001 }).success).toBe(false);
    expect(shipmentSchema.safeParse({ grossWeightKg: -1 }).success).toBe(false);
  });
});