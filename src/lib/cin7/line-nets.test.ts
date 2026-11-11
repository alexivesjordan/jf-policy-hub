import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { resolveCin7LineNets } from "./line-nets";

/** First two lines of the anonymised SO-00490 quote. Line Total is ex VAT and Line VAT is separate. */
const recorded = JSON.parse(
  readFileSync(path.join(process.cwd(), "src/lib/cin7/fixtures/so-00490-order-ex-tax.json"), "utf8"),
) as {
  Lines: { Total: number; Tax: number }[];
  TotalBeforeTax: number;
  Tax: number;
  Total: number;
};

const lines = recorded.Lines.map((line) => ({ total: line.Total, tax: line.Tax }));
const order = { beforeTax: recorded.TotalBeforeTax, includingTax: recorded.Total };

describe("Cin7 line totals", () => {
  it("uses the recorded SO-00490 totals when they match the order total before tax", () => {
    const resolved = resolveCin7LineNets(lines, [], order);
    assert.deepEqual(resolved.lineNets, [679.17, 195.83]);
    assert.equal(resolved.taxStripped, false);
    assert.deepEqual(resolved.flags, []);
  });

  it("includes additional charges in the before-tax check", () => {
    const resolved = resolveCin7LineNets(
      [{ total: 49066.53, tax: 9813.306 }],
      [{ description: "Installation and delivery", total: 5750, tax: 1150 }],
      { beforeTax: 54816.53, includingTax: 65779.84 },
    );
    assert.deepEqual(resolved.lineNets, [49066.53]);
    assert.deepEqual(resolved.charges, [{ description: "Installation and delivery", amountNet: 5750 }]);
    assert.equal(resolved.taxStripped, false);
    assert.equal(resolved.flags.some((flag) => flag.code === "cin7_tax_included"), false);
    assert.equal(resolved.flags.some((flag) => flag.code === "cin7_totals_mismatch"), false);
  });

  it("strips tax when the same lines are recorded inclusive of tax", () => {
    const inclusive = recorded.Lines.map((line) => ({ total: line.Total + line.Tax, tax: line.Tax }));
    const resolved = resolveCin7LineNets(inclusive, [], order);
    assert.deepEqual(resolved.lineNets, [679.17, 195.83]);
    assert.equal(resolved.taxStripped, true);
    assert.equal(resolved.flags.some((flag) => flag.code === "cin7_tax_included"), true);
  });

  it("accepts a difference of £0.10 and keeps totals beyond that", () => {
    const close = resolveCin7LineNets(lines, [], { beforeTax: 875.1, includingTax: 1050 });
    assert.deepEqual(close.lineNets, [679.17, 195.83]);
    assert.equal(close.taxStripped, false);

    const wide = resolveCin7LineNets(lines, [], { beforeTax: 875.11, includingTax: 1050.2 });
    assert.deepEqual(wide.lineNets, [679.17, 195.83]);
    const mismatch = wide.flags.find((flag) => flag.code === "cin7_totals_mismatch");
    assert.ok(mismatch);
    assert.equal(mismatch.difference, -0.11);
  });

  it("keeps the line totals when the order total is missing", () => {
    const resolved = resolveCin7LineNets(lines, [], { beforeTax: null, includingTax: null });
    assert.deepEqual(resolved.lineNets, [679.17, 195.83]);
    assert.equal(resolved.flags.some((flag) => flag.code === "cin7_order_total_missing"), true);
  });
});
