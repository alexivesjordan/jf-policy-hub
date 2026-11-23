import { describe, expect, it } from "vitest";
import { packBoxes, readCin7Sale, type Cin7Getter } from "./read-sale";
import { ordersFromCin7 } from "@/features/logistics/commercial-invoice/prepare";

const saleId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";

/** SO-00779 shape: two pack lines share Box 1, and Box 2 is the second parcel. Cin7 sends no size or type. */
const so00779 = {
  ID: saleId,
  Customer: "NonStop Gym SA",
  CustomerID: customerId,
  Currency: "CHF",
  Order: {
    SaleOrderNumber: "SO-00779",
    Lines: [{ ProductID: productId, SKU: "JF-1", Name: "Bench", Quantity: 1, Price: 10, Tax: 0, Total: 10 }],
    TotalBeforeTax: 10,
    Tax: 0,
    Total: 10,
  },
  Fulfilments: [
    {
      FulFilmentStatus: "FULFILLED",
      Pack: {
        Lines: [
          { SKU: "JF-1", Quantity: 1, Box: "Box 1" },
          { SKU: "JF-2", Quantity: 1, Box: "Box 1" },
          { SKU: "JF-3", Quantity: 1, Box: "Box 2" },
        ],
      },
    },
    {
      FulFilmentStatus: "VOIDED",
      Pack: { Lines: [{ SKU: "JF-9", Quantity: 1, Box: "Box 9" }] },
    },
  ],
};

describe("Cin7 pack boxes", () => {
  it("reads one row per distinct box and ignores a voided fulfilment", () => {
    expect(packBoxes(so00779)).toEqual(["Box 1", "Box 2"]);
    expect(packBoxes({ Fulfilments: [] })).toEqual([]);
    expect(packBoxes({})).toEqual([]);
  });

  it("puts those boxes on the quote from a GET sale shaped like SO-00779", async () => {
    const get: Cin7Getter = async (path) => {
      if (path === "saleList") return { SaleList: [{ SaleID: saleId, OrderNumber: "SO-00779", CustomerID: customerId }] };
      if (path === "sale") return so00779;
      if (path === "product") return { Products: [{ ID: productId, SKU: "JF-1", Name: "Bench", Weight: 1 }] };
      if (path === "customer") return { CustomerList: [{ ID: customerId, Name: "NonStop Gym SA" }] };
      throw new Error(path);
    };
    const quote = await readCin7Sale("SO-00779", get);
    expect(quote?.boxes).toEqual(["Box 1", "Box 2"]);
    expect(quote?.number).toBe("SO-00779");
    const [order] = ordersFromCin7(quote ? [quote] : [], []);
    expect(order?.boxes).toEqual(["Box 1", "Box 2"]);
  });
});