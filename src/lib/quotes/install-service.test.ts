import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Cin7Quote } from "@/lib/cin7/types";
import { quoteFlag } from "@/lib/quotes/flags";
import {
  ingestCin7Quote,
  ingestDraft,
  parseServiceReconcile,
  serialiseServiceReconcile,
  serviceReconcileFromCin7,
} from "@/lib/quotes/ingest";
import { calculateServiceQuote } from "@/lib/service-quote/engine";

const quote: Cin7Quote = {
  id: "sale-1",
  number: "SO-00490",
  customerName: "Example Sports Centre",
  customerRef: "EXAMPLE",
  segment: "independent",
  customerType: "proforma",
  postcode: "IP1 9ZZ",
  lines: [
    { sku: "TREAD", productName: "Jordan Elite treadmill", category: "cardio", qty: 1, lineNet: 1000 },
    { sku: "BENCH", productName: "Adjustable bench", category: "bench", qty: 2, lineNet: 200 },
  ],
  additionalCharges: [
    { description: "Installation and packaging removal", amountNet: 5000 },
    { description: "Delivery Charge", amountNet: 750 },
  ],
  moneyFlags: [quoteFlag("cin7_totals_mismatch", "Cin7 product lines plus additional charges differ from the order total before tax by £10.00. The line totals were kept.", -10)],
};

describe("install quoting service handoff", () => {
  it("passes the service page goods net, order total, charges, and flags", () => {
    const direct = ingestCin7Quote(quote);
    const carried = parseServiceReconcile(serialiseServiceReconcile(serviceReconcileFromCin7(quote)));
    assert.equal(carried.goodsNet, direct.goodsNet);
    assert.equal(carried.orderNet, direct.orderNet);
    assert.deepEqual(carried.deliveryInstallLines, direct.deliveryInstallLines);
    assert.deepEqual(carried.flags.map((flag) => flag.code), ["cin7_totals_mismatch"]);
    assert.equal(carried.flags[0]?.difference, -10);

    const ingested = ingestDraft({
      source: "cin7",
      quoteNumber: quote.number,
      customerName: quote.customerName,
      postcode: quote.postcode ?? "",
      goodsNet: carried.goodsNet,
      orderNet: carried.orderNet,
      lines: quote.lines.map((line) => ({
        sku: line.sku ?? "",
        description: line.productName,
        qty: line.qty,
        lineTotal: line.lineNet ?? null,
        category: line.category ?? "",
      })),
      warnings: [],
      deliveryInstallLines: carried.deliveryInstallLines,
      flags: carried.flags,
    });
    const result = calculateServiceQuote({
      customer: ingested.customerName,
      quoteNumber: ingested.quoteNumber,
      currency: "GBP",
      goodsNet: ingested.goodsNet,
      sites: [{
        name: "Site",
        address: ingested.postcode,
        lineItems: [
          ...ingested.lines.map((line) => ({
            sku: line.sku,
            description: line.description,
            quantity: line.qty,
            lineNet: line.lineNet,
            category: "strength_machine" as const,
          })),
          ...ingested.deliveryInstallLines.map((line) => ({
            description: line.description,
            quantity: 1,
            lineNet: line.amountNet,
            category: "delivery_install" as const,
          })),
        ],
      }],
    });
    const priced = { ...result, flags: [...ingested.flags, ...result.flags] };

    assert.equal(priced.flags.some((flag) => flag.code === "goods_net_missing"), false);
    assert.equal(priced.goodsNetDiscrepancy, 0);
    assert.equal(priced.goodsNetFromLines, 1200);
    assert.equal(ingested.orderNet, 6950);
    assert.equal(priced.goodsNetFromLines + 5750, ingested.orderNet);
    assert.equal(priced.flags.some((flag) => flag.code === "cin7_totals_mismatch" && flag.difference === -10), true);
    assert.deepEqual(
      ingested.deliveryInstallLines.map((line) => line.amountNet),
      [5000, 750],
    );
  });
});
