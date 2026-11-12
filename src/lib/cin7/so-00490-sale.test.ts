import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { readCin7Sale, type Cin7Getter } from "./read-sale";
import { ingestCin7Quote } from "@/lib/quotes/ingest";
import { classifyLine } from "@/lib/service-quote/classify";
import { calculateServiceQuote } from "@/lib/service-quote/engine";

const sale = JSON.parse(
  readFileSync(path.join(process.cwd(), "src/lib/cin7/fixtures/so-00490-anon.json"), "utf8"),
) as { ID: string; CustomerID: string; Order: { Lines: unknown[] } };

function getter(): Cin7Getter {
  return async (requestPath) => {
    if (requestPath === "sale") return sale;
    if (requestPath === "product") return { Products: [] };
    if (requestPath === "customer") {
      return {
        CustomerList: [{
          ID: sale.CustomerID,
          Name: "Example Customer",
          Addresses: [{ Type: "Shipping", DefaultForType: true, Postcode: "IP1 9ZZ" }],
        }],
      };
    }
    throw new Error(`unexpected ${requestPath}`);
  };
}

describe("anonymised SO-00490 sale", () => {
  it("reconciles product lines plus additional charges and prices the warranty", async () => {
    const quote = await readCin7Sale(sale.ID, getter());
    assert.ok(quote);
    assert.equal(quote.lines.length, 47);
    assert.equal(quote.taxStripped, false);
    assert.equal(quote.moneyFlags?.some((flag) => flag.code === "cin7_tax_included"), false);
    assert.equal(quote.moneyFlags?.some((flag) => flag.code === "cin7_totals_mismatch"), false);
    assert.deepEqual(
      quote.additionalCharges?.map((charge) => charge.amountNet),
      [5000, 750],
    );
    const dumped = JSON.stringify(quote);
    assert.equal(dumped.includes("jane.example@example.com"), false);
    assert.equal(dumped.includes("01603 000000"), false);
    assert.equal(dumped.includes("Example Street"), false);
    assert.equal(dumped.includes("Nik Elphick"), false);

    const ingested = ingestCin7Quote(quote);
    assert.equal(ingested.goodsNet, 49066.53);
    assert.equal(ingested.orderNet, 54816.53);
    assert.equal(ingested.lines.some((line) => line.lineNet === 0), false);
    assert.deepEqual(
      ingested.deliveryInstallLines.map((line) => [line.description, line.amountNet]),
      [
        ["Installation and Removal/Recycling of Packaging", 5000],
        ["Delivery Charge", 750],
      ],
    );

    const result = calculateServiceQuote({
      customer: ingested.customerName || "Customer",
      quoteNumber: ingested.quoteNumber,
      currency: "GBP",
      goodsNet: ingested.goodsNet,
      sites: [{
        name: ingested.customerName || "Site",
        address: ingested.postcode,
        lineItems: [
          ...ingested.lines.map((line) => {
            const classified = classifyLine({ sku: line.sku, description: line.description, cin7Category: line.cin7Category });
            return {
              sku: line.sku,
              description: line.description,
              quantity: line.qty,
              lineNet: line.lineNet,
              category: classified.category,
              reviewNote: classified.reasons.join(" "),
            };
          }),
          ...ingested.deliveryInstallLines.map((line) => ({
            description: line.description,
            quantity: 1,
            lineNet: line.amountNet,
            category: "delivery_install" as const,
          })),
        ],
      }],
    });
    const prices = result.sites[0]?.prices;
    assert.ok(prices);
    assert.equal(result.goodsNetFromLines, 49066.53);
    assert.equal(result.goodsNetFromLines + 5750, ingested.orderNet);
    assert.equal(result.goodsNetDiscrepancy, 0);
    assert.equal(result.flags.some((flag) => flag.code === "cin7_tax_included" || flag.code === "goods_net_missing"), false);
    assert.equal(result.flags.some((flag) => flag.message.includes("cannot be established")), false);
    assert.equal(result.flags.filter((flag) => flag.message.includes("Identity and actual number")).length, 3);
    assert.equal(prices.pmUnits, 28);
    assert.equal(prices.annualPm, 1895);
    assert.equal(prices.twiceYearlyPm, 3495);
    assert.equal(prices.extendedWarrantyOneOff, 2395);
    assert.equal(prices.annualBundleYear1, 4095);
    assert.equal(prices.twiceBundleYear1, 5695);
  });
});
