import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readCin7Sale, type Cin7Getter } from "./read-sale";

const saleId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";

function fixtureGet(): { get: Cin7Getter; calls: string[] } {
  const calls: string[] = [];
  const get: Cin7Getter = async (path, query) => {
    calls.push(`${path}?${new URLSearchParams(query).toString()}`);
    if (path === "saleList") {
      return {
        Total: 2,
        Page: 1,
        SaleList: [
          { SaleID: "99999999-9999-4999-8999-999999999999", OrderNumber: "SO-00491", Customer: "Other Gym", CustomerID: customerId },
          { SaleID: saleId, OrderNumber: "SO-00490", Customer: "Sample Fitness Club", CustomerID: customerId, CustomerReference: "06/11" },
        ],
      };
    }
    if (path === "sale") {
      return {
        ID: saleId,
        Customer: "Sample Fitness Club",
        CustomerID: customerId,
        CustomerReference: "06/11",
        Phone: "07000000000",
        Email: "hidden@example.com",
        ShippingAddress: { Line1: "1 Secret Road", City: "Ipswich", Postcode: "PE30 4JJ" },
        Order: {
          SaleOrderNumber: "SO-00490",
          Lines: [{ ProductID: productId, SKU: "JF-C2SE-2", Name: "Concept2 SkiErg", Quantity: 2, Total: 10 }],
        },
      };
    }
    if (path === "product") {
      return {
        Products: [{ ID: productId, SKU: "JF-C2SE-2", Name: "Concept2 SkiErg", Category: "Cardio", Weight: 26, Length: 120, Width: 40, Height: 30 }],
      };
    }
    if (path === "customer") {
      return {
        CustomerList: [{
          ID: customerId,
          Name: "Sample Fitness Club",
          Email: "hidden@example.com",
          Phone: "07000000000",
          Addresses: [
            { Type: "Billing", DefaultForType: true, Line1: "Accounts lane", Postcode: "PE30 4JJ" },
            { Type: "Shipping", DefaultForType: true, Line1: "1 Anonymised Road", Postcode: "IP14NJ" },
          ],
        }],
      };
    }
    throw new Error(`unexpected ${path}`);
  };
  return { get, calls };
}

describe("Cin7 sale read", () => {
  it("looks up SO-00490 and keeps personal address fields off the quote", async () => {
    const { get, calls } = fixtureGet();
    const quote = await readCin7Sale("SO-00490", get);
    assert.ok(quote);
    assert.equal(quote.number, "SO-00490");
    assert.equal(quote.customerName, "Sample Fitness Club");
    assert.equal(quote.postcode, "IP1 4NJ");
    assert.equal(quote.segment, null);
    assert.equal(quote.lines[0].sku, "JF-C2SE-2");
    assert.equal(quote.lines[0].qty, 2);
    assert.equal(quote.lines[0].unitWeightKg, 26);
    assert.equal(quote.lines[0].cin7Category, "Cardio");
    assert.equal(quote.lines[0].category, null);
    assert.equal(quote.lines[0].length, 120);
    assert.equal(calls.filter((call) => call.startsWith("saleList?")).length, 1);
    assert.equal(calls.some((call) => call.includes(`sale?ID=${saleId}`)), true);
    assert.equal(calls.some((call) => call.startsWith("product?") && call.includes(`ID=${productId}`)), true);
    assert.equal(calls.some((call) => call.startsWith("customer?") && call.includes(`ID=${customerId}`)), true);
    const dumped = JSON.stringify(quote);
    assert.equal(dumped.includes("hidden@example.com"), false);
    assert.equal(dumped.includes("07000000000"), false);
    assert.equal(dumped.includes("Secret Road"), false);
    assert.equal(dumped.includes("Anonymised Road"), false);
    assert.equal(dumped.includes("Accounts lane"), false);
  });

  it("ignores a weight that is not in kilograms", async () => {
    const { get } = fixtureGet();
    const wrapped: Cin7Getter = async (path, query) => {
      const body = await get(path, query);
      if (path !== "product" || !body || typeof body !== "object") return body;
      const products = (body as { Products: Record<string, unknown>[] }).Products;
      products[0] = { ...products[0], Weight: 26, WeightUnits: "lb" };
      return { Products: products };
    };
    const quote = await readCin7Sale("SO-00490", wrapped);
    assert.equal(quote?.lines[0].unitWeightKg, null);
    assert.equal(quote?.weightIgnored, true);
  });
});
