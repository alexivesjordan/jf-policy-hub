import { describe, expect, it } from "vitest";
import { readCin7Sale, type Cin7Getter } from "./read-sale";

const saleId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";

function getter(product: Record<string, unknown>): Cin7Getter {
  return async (path) => {
    if (path === "saleList") {
      return { SaleList: [{ SaleID: saleId, OrderNumber: "SO-00819", CustomerID: customerId }] };
    }
    if (path === "sale") {
      return {
        ID: saleId,
        Customer: "Sample Fitness Club",
        CustomerID: customerId,
        Currency: "GBP",
        BillingAddress: { Line1: "1 Road", City: "Lynn", Country: "United Kingdom" },
        ShippingAddress: { Line1: "1 Road", City: "Lynn", Country: "Spain", Postcode: "28001" },
        Order: {
          SaleOrderNumber: "SO-00819",
          Lines: [{ ID: "line-1", ProductID: productId, SKU: "JF-SFM-BLK-10-1200", Name: "Studio functional machine", Quantity: 1, Price: 10, Tax: 0, Total: 10 }],
          TotalBeforeTax: 10,
          Tax: 0,
          Total: 10,
        },
      };
    }
    if (path === "product") return { Products: [{ ID: productId, SKU: "JF-SFM-BLK-10-1200", ...product }] };
    if (path === "customer") {
      return { CustomerList: [{ ID: customerId, Name: "Sample Fitness Club", Addresses: [] }] };
    }
    throw new Error("unexpected " + path);
  };
}

describe("Cin7 product customs fields", () => {
  it("normalises the HS code and stores the origin as ISO2", async () => {
    const named = await readCin7Sale("SO-00819", getter({ HSCode: "95069190", CountryOfOrigin: "Spain", CountryOfOriginCode: "ESP", Weight: 12, WeightUnits: "kg" }));
    expect(named?.lines[0]).toMatchObject({ sku: "JF-SFM-BLK-10-1200", hsCode: "9506919000", originCountry: "ES", unitWeightKg: 12 });
    const coded = await readCin7Sale("SO-00819", getter({ HSCode: "9506.91", CountryOfOrigin: "", CountryOfOriginCode: "ESP" }));
    expect(coded?.lines[0]).toMatchObject({ hsCode: "9506910000", originCountry: "ES" });
  });
});
