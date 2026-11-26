import { describe, expect, it } from "vitest";
import { readCin7ServicePrefill, type Cin7Getter } from "./read-sale";

const saleId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";

function getter(): Cin7Getter {
  return async (path) => {
    if (path === "saleList") {
      return { SaleList: [{ SaleID: saleId, OrderNumber: "SO-00490", CustomerID: customerId }] };
    }
    if (path === "sale") {
      return {
        ID: saleId,
        Customer: "Sample Fitness Club",
        CustomerID: customerId,
        Phone: "01603 000000",
        Email: "desk@example.com",
        Contact: "Pat Example",
        ShippingAddress: { Line1: "1 Secret Road", Line2: "Unit 2", City: "Ipswich", Postcode: "PE30 4JJ" },
      };
    }
    if (path === "customer") {
      return {
        CustomerList: [{
          ID: customerId,
          Name: "Sample Fitness Club",
          Addresses: [{ Type: "Shipping", DefaultForType: true, Line1: "1 Anonymised Road", Postcode: "IP1 4NJ" }],
        }],
      };
    }
    return null;
  };
}

describe("Cin7 service prefill", () => {
  it("uses the sale delivery address and contact, not a historic customer address", async () => {
    const prefill = await readCin7ServicePrefill("SO-00490", getter());
    expect(prefill).toMatchObject({
      customerName: "Sample Fitness Club",
      addressLine1: "1 Secret Road",
      addressLine2: "Unit 2",
      city: "Ipswich",
      postcode: "PE30 4JJ",
      contactName: "Pat Example",
      contactEmail: "desk@example.com",
      contactPhone: "01603 000000",
    });
  });

  it("returns nothing for a blank order number", async () => {
    expect(await readCin7ServicePrefill("  ", getter())).toBeNull();
  });
});
