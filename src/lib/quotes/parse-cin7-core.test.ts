import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { cin7CoreExtractor, parseCin7CoreQuote } from "./parse-cin7-core";
import { normaliseUkPostcode } from "./postcode";

const fixture = readFileSync(
  path.join(process.cwd(), "src/lib/quotes/fixtures/cin7-quote-SO-00490.anonymised.txt"),
  "utf8",
);

describe("Cin7 Core quote layout", () => {
  const quote = parseCin7CoreQuote(fixture);

  it("reads the anonymised SO-00490 header", () => {
    assert.equal(quote.quoteNumber, "SO-00490");
    assert.equal(quote.customerName, "Sample Fitness Ltd");
    assert.equal(quote.postcode, "IP1 4NJ");
    assert.equal(quote.salesContactName, "Jordan Example");
    assert.equal(quote.salesContactEmail, "sales.example@example.com");
    assert.equal(quote.orderNo, "SO-00490");
    assert.equal(quote.currency, "GBP");
    assert.equal(quote.customerReference, "SAMPLE-REF");
    assert.equal(quote.segment, null);
    assert.equal(quote.goodsNet, 46989.52);
    assert.equal(quote.additionalChargesNet, 0);
    assert.equal(quote.totalOrderNet, 46989.52);
  });

  it("reassembles wrapped SKUs and sums 44 lines to Goods Net", () => {
    assert.equal(quote.lines.length, 44);
    assert.equal(quote.lines[0]?.sku, "JTRBARSN2-1N-RC");
    assert.equal(quote.lines[0]?.description, "Jordan snatch bar");
    assert.equal(quote.lines[1]?.sku, "JTDR-05-10BLK");
    assert.equal(quote.lines[1]?.description, "Rubber dumbbell");
    assert.equal(quote.lines[10]?.sku, "JTRBAR-20KG");
    const sum = Math.round(quote.lines.reduce((total, line) => total + line.lineTotal, 0) * 100) / 100;
    assert.equal(sum, 46989.52);
    assert.equal(quote.warnings.length, 0);
  });

  it("warns when line totals do not match Goods Net", () => {
    const broken = fixture.replace("Goods Net 46,989.52", "Goods Net 46,000.00");
    const parsed = parseCin7CoreQuote(broken);
    assert.equal(parsed.lines.length, 44);
    assert.ok(parsed.warnings.some((warning) => warning.includes("46,989.52") || warning.includes("46989.52")));
    assert.ok(parsed.warnings.some((warning) => warning.includes("46000.00")));
  });

  it("normalises a compact postcode", () => {
    assert.equal(normaliseUkPostcode("IP14NJ"), "IP1 4NJ");
    assert.equal(normaliseUkPostcode("ip14 8nj"), "IP14 8NJ");
    assert.equal(normaliseUkPostcode("NR11AA"), "NR1 1AA");
  });

  it("keeps the extractor replaceable", () => {
    const other = { id: "later-model", extract: () => parseCin7CoreQuote("Quote No: SO-1\nGoods Net 0.00") };
    assert.equal(cin7CoreExtractor.id, "cin7-core-text");
    assert.equal(other.id, "later-model");
    assert.equal(cin7CoreExtractor.extract(fixture).lines.length, 44);
  });
});
