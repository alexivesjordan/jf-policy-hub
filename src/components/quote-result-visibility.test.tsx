import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QuoteLineFields } from "@/components/quote-line-fields";
import { compactPriceFlags, InstallPriceNotes, type InstallPriceNotesData } from "@/components/price-workings";
import { ServiceQuoteResult } from "@/components/service-quote-view";

const notes: InstallPriceNotesData = {
  bigInstall: true,
  bigInstallTriggers: ["weight over 2000kg"],
  paymentGate: "Customer type is not set, so the payment terms are not chosen yet.",
  unset: ["handover_minutes", "min_job_charge"],
  assumptions: ["HIDDEN-BUILD crew 2 and build minutes 180"],
  flags: [
    "weight estimated from band on HIDDEN-TREADMILL",
    "SKU blank - add Cin7 SKU so quote lines match exactly.",
    "Needs review: HIDDEN-RACK",
    "Needs review: HIDDEN-BIKE",
    "Crew plan: overnight. 2 days, 1 night.",
  ],
};

const service = {
  id: null,
  quoteNumber: "SO-1",
  customerName: "Example Sports Centre",
  rateVersion: "v1",
  portfolioPm: null,
  warnings: [],
  deliveryInstall: [{ description: "Delivery Charge", amountNet: 750 }],
  flags: [{ code: "manual_review", difference: null, message: "The model is not named." }],
  audit: { goodsNetFromLines: 49066.53, goodsNetDiscrepancy: 0, assumptions: ["HIDDEN-AUDIT-NOTE"] },
  prices: [{
    name: "Site",
    address: "IP1 9ZZ",
    goodsNet: 1000,
    flags: [],
    lineItems: [{
      sku: "HIDDEN-SKU",
      description: "HIDDEN-PRODUCT",
      quantity: 9,
      lineNet: 1000,
      category: "strength_machine",
      pmUnits: 1,
      warrantyRate: 0.03,
      warrantyRiskContribution: 30,
      provisional: false,
      reviewNote: "",
    }],
    prices: {
      pmUnits: 1,
      warrantyBaseRisk: 30,
      annualPm: 1895,
      twiceYearlyPm: 3495,
      extendedWarrantyOneOff: 0,
      annualBundleYear1: null,
      twiceBundleYear1: null,
      bundleIncentive: 0,
      hasPmScope: true,
      hasWarrantyScope: false,
    },
    knownOnlySensitivity: {
      pmUnits: 1,
      warrantyBaseRisk: 30,
      annualPm: 1895,
      twiceYearlyPm: 3495,
      extendedWarrantyOneOff: 0,
      annualBundleYear1: null,
      twiceBundleYear1: null,
      bundleIncentive: 0,
      hasPmScope: true,
      hasWarrantyScope: false,
    },
  }],
};

describe("sales quote results hide line lists", () => {
  it("keeps install flags short for every role and leaves products out", () => {
    const lines = compactPriceFlags(notes);
    assert.ok(lines.length <= 6);
    assert.equal(lines.some((line) => /HIDDEN-TREADMILL|HIDDEN-BUILD|Crew plan|Line classification/.test(line)), false);
    assert.equal(lines.some((line) => line.includes("Some products still need a confirmed install time.")), true);
    const html = renderToStaticMarkup(<InstallPriceNotes notes={notes} />);
    assert.equal(html.includes("Line classification"), false);
    assert.equal(html.includes("HQ build"), false);
    assert.equal(html.includes("Crew plans"), false);
    assert.equal(html.includes("HIDDEN-TREADMILL"), false);
  });

  it("posts every line without rendering a product or quantity list", () => {
    const html = renderToStaticMarkup(
      <QuoteLineFields lines={[{
        sku: "HIDDEN-SKU",
        description: "HIDDEN-PRODUCT",
        qty: 9,
        category: "cardio",
        lineTotal: 1000,
        unitWeightKg: null,
        productId: "p1",
        uom: null,
        tileLength: null,
        tileWidth: null,
        dimensionUnit: null,
        tilesPerPack: null,
      }]} />,
    );
    assert.equal(/<table|<th|>SKU<|>Qty</.test(html), false);
    assert.match(html, /type="hidden"/);
    assert.match(html, /name="lineQty" value="9"/);
    assert.match(html, /name="lineDescription" value="HIDDEN-PRODUCT"/);
  });

  it("shows warranty prices only, not flags, a delivery card, a line list, or an audit", () => {
    const html = renderToStaticMarkup(<ServiceQuoteResult service={service} />);
    assert.equal(html.includes("Annual maintenance"), true);
    assert.equal(html.includes("£1,895.00"), true);
    assert.equal(html.includes("Things that may affect this price"), false);
    assert.equal(html.includes("The model is not named."), false);
    assert.equal(html.includes("Delivery Charge"), false);
    assert.equal(html.includes("HIDDEN-SKU"), false);
    assert.equal(html.includes("HIDDEN-PRODUCT"), false);
    assert.equal(html.includes("HIDDEN-AUDIT-NOTE"), false);
    assert.equal(html.includes("Total of the product lines"), false);
    assert.equal(html.includes("Line classification"), false);
  });

  it("does not render flags on the sales quote pages", () => {
    const install = readFileSync(new URL("./price-quote-form.tsx", import.meta.url), "utf8");
    const warranty = readFileSync(new URL("./service-quote-view.tsx", import.meta.url), "utf8");
    const servicePage = readFileSync(new URL("./service-quote-form.tsx", import.meta.url), "utf8");
    assert.equal(install.includes("Things that may affect this price"), false);
    assert.equal(install.includes("InstallPriceNotes"), false);
    assert.equal(install.includes("Line classification"), false);
    assert.equal(warranty.includes("Things that may affect this price"), false);
    assert.equal(servicePage.includes("Things that may affect this price"), false);
    assert.equal(servicePage.includes("ProposalButton"), true);
  });
});
