import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseCin7CoreQuote } from "@/lib/quotes/parse-cin7-core";
import type { ExtractedQuote } from "@/lib/quotes/types";
import { pdfBytesToLayoutText } from "@/lib/quotes/pdf-text";
import { buildSubcontractorDraft, replaceTimeframe } from "@/lib/subcontractors/draft";
import { orderWeightKg, subcontractorKitLines } from "@/lib/subcontractors/quote-kit";

const fixture = path.join(process.cwd(), "src/lib/quotes/fixtures/cin7-sale-SO-00526.pdf");

describe("Cin7 sales order PDF for a subcontractor quote", () => {
  let extracted: ExtractedQuote;
  let lines: { sku: string; description: string; qty: number; unitWeightKg?: number | null }[] = [];

  beforeAll(async () => {
    const text = await pdfBytesToLayoutText(new Uint8Array(readFileSync(fixture)));
    expect(text).toContain("Ship To");
    expect(text).toContain("NR1 1AA");
    expect(text).toContain("Total weight 86.50 kg");
    extracted = parseCin7CoreQuote(text);
    lines = extracted.lines.map((line) => ({
      sku: line.sku,
      description: line.description,
      qty: line.qty,
      unitWeightKg: line.unitWeightKg,
    }));
  });

  it("reads the delivery postcode and ignores the picking-error line", () => {
    expect(extracted.quoteNumber).toBe("SO-00526");
    expect(extracted.postcode).toBe("NR1 1AA");
    expect(extracted.totalWeightKg).toBe(86.5);
    const kit = subcontractorKitLines(lines);
    expect(kit.map((line) => line.description)).toEqual([
      "Concept2 SkiErg - Including PM5 Monitor",
      "J75 Cable Rack",
    ]);
    expect(kit.map((line) => line.qty)).toEqual([1, 1]);
    expect(JSON.stringify(kit)).not.toMatch(/Picking|£|679/);
  });

  it("uses the printed total weight, otherwise Cin7 line weights, otherwise a placeholder", () => {
    expect(orderWeightKg(lines, extracted.totalWeightKg)).toBe(86.5);
    expect(orderWeightKg([
      { sku: "JF-C2SE-2", description: "SkiErg", qty: 2, unitWeightKg: 26 },
      { sku: "JF-J75", description: "Cable rack", qty: 1, unitWeightKg: 34.5 },
    ], null)).toBe(86.5);
    expect(orderWeightKg([
      { sku: "JF-C2SE-2", description: "SkiErg", qty: 1, unitWeightKg: null },
    ], null)).toBeNull();
  });

  it("writes the quote email without an order number", () => {
    const kit = subcontractorKitLines(lines);
    const draft = buildSubcontractorDraft({
      postcode: extracted.postcode ?? "",
      lines: kit,
      weightKg: orderWeightKg(lines, extracted.totalWeightKg),
      timeframe: "w/c 7 December",
      repFirstName: "Alex",
    });
    expect(draft.text).toBe([
      "Hello, hope you're well.",
      "",
      "Can you please provide me with a quote for the below kit list? The total weight of the order is 86.5kg.",
      "",
      "1x Concept2 SkiErg - Including PM5 Monitor",
      "1x J75 Cable Rack",
      "",
      "The install postcode is NR1 1AA.",
      "",
      "We're currently looking at installing this kit w/c 7 December",
      "",
      "Looking forward to seeing a price.",
      "",
      "Best wishes,",
      "Alex",
      "Jordan Fitness",
    ].join("\n"));
    expect(draft.text).not.toMatch(/Order:|SO-00526|Please quote for this install/);
    const edited = replaceTimeframe(draft.text, "early January");
    expect(edited).toContain("We're currently looking at installing this kit early January");
    expect(edited).toContain("1x Concept2 SkiErg");
  });

  it("leaves a visible weight placeholder when the PDF has no weights", () => {
    const draft = buildSubcontractorDraft({
      postcode: "",
      lines: [{ qty: 1, description: "Concept2 SkiErg" }],
      weightKg: null,
      repFirstName: "",
    });
    expect(draft.text).toContain("The total weight of the order is [WEIGHT]kg.");
    expect(draft.text).toContain("The install postcode is [POSTCODE].");
    expect(draft.text).toContain("[TIMEFRAME]");
    expect(draft.text).toContain("[NAME]");
  });
});
