import { describe, expect, it } from "vitest";
import { demandFromSale } from "./sale-lines";

describe("sale lines for a pack estimate", () => {
  it("drops freight and adds two lines of the same SKU", () => {
    expect(demandFromSale([
      { sku: "JF-1", productName: "Bench", qty: 1, cin7Category: "Benches" },
      { sku: "JF-1", productName: "Bench", qty: 2, cin7Category: "Benches" },
      { sku: "FREIGHT", productName: "Delivery", qty: 1 },
      { sku: null, productName: "Loose plate", qty: 1 },
    ])).toEqual([
      { sku: "JF-1", name: "Bench", qty: 3 },
      { sku: "", name: "Loose plate", qty: 1 },
    ]);
  });
});
