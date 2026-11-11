import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { calculateServiceQuote, customerProposalText, sitePrice } from "./engine";
import type { ServiceQuoteInput } from "./engine";

const mixed = JSON.parse(
  readFileSync(new URL("./fixtures/fictional-mixed-gym.json", import.meta.url), "utf8"),
) as {
  customer: string;
  source_document: string;
  quote_number: string;
  quote_date: string;
  currency: string;
  goods_net: number;
  source_notes: string;
  sites: { name: string; address: string; line_items: { sku: string; description: string; quantity: number; line_net: number; category: string }[] }[];
  additional_charges: { description: string; amount_net: number }[];
};

function asInput(source: typeof mixed): ServiceQuoteInput {
  return {
    customer: source.customer,
    sourceDocument: source.source_document,
    quoteNumber: source.quote_number,
    quoteDate: source.quote_date,
    currency: source.currency,
    goodsNet: source.goods_net,
    sourceNotes: source.source_notes,
    additionalCharges: source.additional_charges.map((charge) => ({ description: charge.description, amountNet: charge.amount_net })),
    sites: source.sites.map((site) => ({
      name: site.name,
      address: site.address,
      lineItems: site.line_items.map((line) => ({
        sku: line.sku,
        description: line.description,
        quantity: line.quantity,
        lineNet: line.line_net,
        category: line.category,
      })),
    })),
  };
}

describe("service quote engine", () => {
  it("reproduces the reference PM price points", () => {
    const expected = [
      [14, 995, 1845],
      [17, 1195, 2195],
      [19, 1295, 2395],
      [28, 1895, 3495],
    ] as const;
    for (const [units, annual, twice] of expected) {
      const priced = sitePrice(units, 0);
      assert.equal(priced.annualPm, annual);
      assert.equal(priced.twiceYearlyPm, twice);
    }
  });

  it("prices the fictional mixed gym, including the £2,395 extension", () => {
    const result = calculateServiceQuote(asInput(mixed));
    const site = result.sites[0];
    assert.ok(site);
    assert.equal(result.goodsNetDiscrepancy, 0);
    assert.equal(site.prices.pmUnits, 28);
    assert.equal(site.prices.annualPm, 1895);
    assert.equal(site.prices.twiceYearlyPm, 3495);
    assert.equal(site.prices.extendedWarrantyOneOff, 2395);
    assert.equal(site.prices.annualBundleYear1, 4095);
    assert.equal(site.prices.twiceBundleYear1, 5695);
    assert.equal(site.knownOnlySensitivity.pmUnits, 25);
    assert.equal(site.knownOnlySensitivity.annualPm, 1695);
    assert.equal(site.knownOnlySensitivity.twiceYearlyPm, 3095);
    assert.equal(site.knownOnlySensitivity.extendedWarrantyOneOff, 2195);
    assert.ok(result.flags.some((flag) => flag.includes("Identity")));
    const customer = customerProposalText(result);
    assert.equal(customer.includes("99 + 59"), false);
    assert.equal(customer.includes("1.30"), false);
    assert.equal(customer.includes("PROVISIONAL"), true);
  });

  it("flags a goods-net gap and withholds a warranty price when nothing is eligible", () => {
    const result = calculateServiceQuote({
      customer: "Test",
      quoteNumber: "TEST",
      currency: "GBP",
      goodsNet: 2000,
      sites: [{
        name: "Site A",
        lineItems: [
          { description: "Dumbbell sets", quantity: 1, lineNet: 1500, category: "loose_accessory" },
          { description: "Concept2 machine", quantity: 1, lineNet: 100, category: "concept2_cardio" },
        ],
      }],
    });
    assert.ok(result.flags.some((flag) => flag.includes("GOODS NET RECONCILIATION")));
    assert.equal(result.sites[0]?.prices.extendedWarrantyOneOff, 0);
    assert.equal(result.sites[0]?.prices.annualBundleYear1, null);
  });

  it("refuses a non-GBP currency", () => {
    assert.throws(
      () => calculateServiceQuote({ customer: "Test", currency: "EUR", sites: [{ lineItems: [] }] }),
      /GBP only/,
    );
  });

  it("applies the portfolio discount across sites", () => {
    const result = calculateServiceQuote({
      customer: "Test",
      quoteNumber: "PORTFOLIO",
      currency: "GBP",
      sites: [14, 17, 19].map((qty, index) => ({
        name: ["A", "B", "C"][index],
        lineItems: [{ description: "Selectorised strength", quantity: qty, lineNet: 10000, category: "strength_machine" }],
      })),
    });
    assert.equal(result.portfolioPm?.annualPmAllSites, 3135);
    assert.equal(result.portfolioPm?.twiceYearlyPmAllSites, 5790);
  });
});
