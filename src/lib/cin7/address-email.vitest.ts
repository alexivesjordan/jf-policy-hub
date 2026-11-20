import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { orderContactEmailChoice, readCin7AddressReport, readCin7Sale, type Cin7Getter } from "@/lib/cin7/read-sale";

const saleId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";

function baseGet(addresses: Record<string, unknown>[], shipping: Record<string, unknown> | null): Cin7Getter {
  return async (pathName) => {
    if (pathName === "sale") {
      return {
        ID: saleId,
        Customer: "Sample Fitness Club",
        CustomerID: customerId,
        Email: "",
        Contact: "Alex",
        ShippingAddress: shipping ?? {},
        Order: {
          SaleOrderNumber: "SO-00650",
          Lines: [{ ProductID: "33333333-3333-4333-8333-333333333333", SKU: "JF-EC-1", Name: "Elite Cardio", Quantity: 1, Price: 10, Tax: 0, Total: 10 }],
          TotalBeforeTax: 10,
          Tax: 0,
          Total: 10,
        },
      };
    }
    if (pathName === "customer") {
      return { CustomerList: [{ ID: customerId, Name: "Sample Fitness Club", Addresses: addresses, Contacts: [] }] };
    }
    if (pathName === "product") return { Products: [] };
    throw new Error(pathName);
  };
}

describe("Cin7 delivery address", () => {
  it("uses the sale shipping address when it is present", async () => {
    const report = await readCin7AddressReport(saleId, baseGet(
      [{ Type: "Shipping", DefaultForType: true, Line1: "Default yard", Postcode: "CB8 7GJ" }],
      { Line1: "1 Harbour", City: "King's Lynn", Postcode: "PE30 4JJ" },
    ));
    expect(report?.addressSource).toBe("sale");
    expect(report?.postcode).toBe("PE30 4JJ");
    expect(report?.address).toContain("1 Harbour");
  });

  it("uses only the default shipping address when the sale has none", async () => {
    const report = await readCin7AddressReport(saleId, baseGet(
      [{ Type: "Shipping", DefaultForType: true, Line1: "1 Anonymised Road", Postcode: "IP1 4NJ" }],
      { Line1: "", Postcode: "" },
    ));
    expect(report?.addressSource).toBe("default-shipping");
    expect(report?.postcode).toBe("IP1 4NJ");
  });

  it("does not use a non-default shipping address", async () => {
    const quote = await readCin7Sale(saleId, baseGet(
      [{ Type: "Shipping", DefaultForType: false, Line1: "22 Jersey Medow", Postcode: "CB8 7GJ" }],
      {},
    ));
    expect(quote?.postcode).toBeNull();
  });

  it("does not use a billing address", async () => {
    const report = await readCin7AddressReport(saleId, baseGet(
      [{ Type: "Billing", DefaultForType: true, Line1: "Accounts lane", Postcode: "PE30 4JJ" }],
      {},
    ));
    expect(report?.addressSource).toBe("none");
    expect(report?.postcode).toBeNull();
    expect(report?.address).toBeNull();
  });

  it("leaves the postcode empty when nothing qualifies", async () => {
    const report = await readCin7AddressReport(saleId, baseGet([], {}));
    expect(report?.addressSource).toBe("none");
    expect(report?.postcode).toBeNull();
  });
});

describe("customer email ladder", () => {
  const contacts = {
    Email: "",
    Contacts: [
      { Name: "Alex", Email: "", Default: false },
      { Name: "Sam", Email: "sam.example@example.com", Default: false },
      { Name: "Office", Email: "office.example@example.com", Default: true },
    ],
  };

  it("uses the sale email first", () => {
    expect(orderContactEmailChoice({ Email: "sale.example@example.com", Contact: "Sam" }, contacts)?.source).toBe("sale");
  });

  it("uses the customer card email next", () => {
    expect(orderContactEmailChoice({ Email: "", Contact: "Sam" }, { ...contacts, Email: "card.example@example.com" })?.source).toBe("customer");
  });

  it("uses the contact named on the sale", () => {
    expect(orderContactEmailChoice({ Email: "", Contact: "Sam" }, contacts)).toEqual({
      email: "sam.example@example.com",
      source: "named-contact",
    });
  });

  it("uses the default contact last", () => {
    expect(orderContactEmailChoice({ Email: "", Contact: "Nobody" }, contacts)?.source).toBe("default-contact");
  });

  it("finds nothing when every rung is empty", () => {
    expect(orderContactEmailChoice({ Email: "", Contact: "Alex" }, { Email: "", Contacts: [{ Name: "Alex", Email: "", Default: true }] })).toBeNull();
  });
});

describe("elite cardio migration", () => {
  it("does not overwrite a confirmed effort row", () => {
    const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20261121090100_elite_cardio_hq.sql"), "utf8");
    expect(sql).toMatch(/status\s*<>\s*'confirmed'/);
    expect(sql).not.toMatch(/20261114160000/);
  });
});
