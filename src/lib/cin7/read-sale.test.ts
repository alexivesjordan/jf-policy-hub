import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { orderContactEmail, readCin7BookingDetails, readCin7Sale, type Cin7Getter } from "./read-sale";

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
          Lines: [{ ProductID: productId, SKU: "JF-C2SE-2", Name: "Concept2 SkiErg", Quantity: 2, Price: 5, Tax: 0, Total: 10 }],
          TotalBeforeTax: 10,
          Tax: 0,
          Total: 10,
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
    assert.equal(quote.postcode, "PE30 4JJ");
    assert.equal(quote.segment, null);
    assert.equal(quote.lines[0].sku, "JF-C2SE-2");
    assert.equal(quote.lines[0].qty, 2);
    assert.equal(quote.lines[0].lineNet, 10);
    assert.equal(quote.taxStripped, false);
    assert.deepEqual(quote.moneyFlags, []);
    assert.equal(quote.lines[0].unitWeightKg, 26);
    assert.equal(quote.lines[0].hsCode, null);
    assert.equal(quote.lines[0].originCountry, null);
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
    assert.equal(quote.consigneeAddress?.includes("Secret Road"), true);
    assert.equal(quote.buyerAddress?.includes("Accounts lane"), true);
    assert.equal(dumped.includes("Anonymised Road"), false);
    const details = await readCin7BookingDetails("SO-00490", get);
    assert.equal(details?.siteAddress, "1 Secret Road, Ipswich, PE30 4JJ");
    assert.equal(details?.siteAddress?.includes("1 Anonymised Road"), false);
    assert.equal(details?.contactEmail, "hidden@example.com");
    assert.equal(JSON.stringify(quote).includes("1 Anonymised Road"), false);
  });

  it("uses the customer default shipping address only when the sale has no delivery address", async () => {
    const { get } = fixtureGet();
    const wrapped: Cin7Getter = async (pathName, query) => {
      const body = await get(pathName, query);
      if (pathName !== "sale" || !body || typeof body !== "object") return body;
      return { ...(body as Record<string, unknown>), ShippingAddress: { Line1: "", Postcode: "" } };
    };
    const quote = await readCin7Sale("SO-00490", wrapped);
    assert.equal(quote?.postcode, "IP1 4NJ");
    const details = await readCin7BookingDetails("SO-00490", wrapped);
    assert.equal(details?.siteAddress, "1 Anonymised Road, IP1 4NJ");
  });

  it("does not use a non-default customer shipping address when the sale has no delivery address", async () => {
    const { get } = fixtureGet();
    const wrapped: Cin7Getter = async (pathName, query) => {
      const body = await get(pathName, query);
      if (pathName === "sale" && body && typeof body === "object") {
        return { ...(body as Record<string, unknown>), ShippingAddress: {} };
      }
      if (pathName === "customer" && body && typeof body === "object") {
        const listed = (body as { CustomerList: Record<string, unknown>[] }).CustomerList;
        listed[0] = {
          ...listed[0],
          Addresses: [
            { Type: "Billing", DefaultForType: true, Line1: "Accounts lane", Postcode: "PE30 4JJ" },
            { Type: "Shipping", DefaultForType: false, Line1: "22 Jersey Medow", City: "Kentford", Postcode: "CB8 7GJ" },
          ],
        };
        return { CustomerList: listed };
      }
      return body;
    };
    const quote = await readCin7Sale("SO-00490", wrapped);
    assert.equal(quote?.postcode, null);
    const details = await readCin7BookingDetails("SO-00490", wrapped);
    assert.equal(details?.siteAddress, null);
  });

  it("reads the sale email, then a named contact, then the default contact", () => {
    const sale = { Email: "", Contact: "Alex" };
    const customer = {
      Contacts: [
        { Name: "Alex", Email: null, Default: true },
        { Name: "Sam", Email: "sam.example@example.com", Default: false },
      ],
    };
    assert.equal(orderContactEmail(sale, customer), null);
    assert.equal(orderContactEmail({ Email: "alex.ives@jordanfitness.com", Contact: "Alex" }, customer), "alex.ives@jordanfitness.com");
    assert.equal(orderContactEmail({ Email: "", Contact: "Sam" }, customer), "sam.example@example.com");
    assert.equal(
      orderContactEmail({ Email: "", Contact: "Nobody" }, {
        Contacts: [{ Name: "Office", Email: "office.example@example.com", Default: true }],
      }),
      "office.example@example.com",
    );
    assert.equal(orderContactEmail({ Email: "" }, { Email: "card.example@example.com", Contacts: [] }), "card.example@example.com");
  });

  it("maps the product HS code and origin onto the sale line", async () => {
    const { get } = fixtureGet();
    const withProduct = (fields: Record<string, unknown>): Cin7Getter => async (path, query) => {
      const body = await get(path, query);
      if (path !== "product" || !body || typeof body !== "object") return body;
      const products = (body as { Products: Record<string, unknown>[] }).Products;
      products[0] = { ...products[0], ...fields };
      return { Products: products };
    };
    const named = await readCin7Sale("SO-00490", withProduct({ HSCode: "95069190", CountryOfOrigin: "Spain", CountryOfOriginCode: "ESP" }));
    assert.equal(named?.lines[0].hsCode, "9506919000");
    assert.equal(named?.lines[0].originCountry, "ES");
    const coded = await readCin7Sale("SO-00490", withProduct({ HSCode: "9506.91", CountryOfOrigin: "", CountryOfOriginCode: "ESP" }));
    assert.equal(coded?.lines[0].hsCode, "9506910000");
    assert.equal(coded?.lines[0].originCountry, "ES");
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

  it("strips tax on a recorded order when line totals include it", async () => {
    const order = JSON.parse(
      readFileSync(path.join(process.cwd(), "src/lib/cin7/fixtures/so-00490-order-ex-tax.json"), "utf8"),
    ) as { Lines: { Tax: number; Total: number }[] };
    for (const line of order.Lines) line.Total = Math.round((line.Total + line.Tax) * 100) / 100;
    const { get } = fixtureGet();
    const wrapped: Cin7Getter = async (pathName, query) => {
      const body = await get(pathName, query);
      if (pathName !== "sale" || !body || typeof body !== "object") return body;
      return { ...(body as Record<string, unknown>), Order: order };
    };
    const quote = await readCin7Sale("SO-00490", wrapped);
    assert.deepEqual(quote?.lines.map((line) => line.lineNet), [679.17, 195.83]);
    assert.equal(quote?.taxStripped, true);
    assert.equal(quote?.moneyFlags?.some((flag) => flag.code === "cin7_tax_included"), true);
  });
});
