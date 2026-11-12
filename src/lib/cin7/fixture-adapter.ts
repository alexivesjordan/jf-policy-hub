import type { Cin7Quote, Cin7ReadClient } from "@/lib/cin7/types";

/** In-memory quotes. SKUs are blank on purpose. Not a live Cin7 account. */
export const FIXTURE_QUOTES: Cin7Quote[] = [
  {
    id: "fixture-quote-1001",
    number: "FIXTURE-Q-1001",
    customerName: "FIXTURE — Riverside Gym",
    postcode: "LS1 4DY",
    customerRef: "FIXTURE-CUST-1",
    segment: "independent",
    customerType: "proforma",
    lines: [
      { sku: null, productName: "FID Bench", category: "bench", qty: 2 },
      { sku: null, productName: "Olympic Flat Bench", category: "bench", qty: 1 },
    ],
  },
  {
    id: "fixture-quote-1002",
    number: "FIXTURE-Q-1002",
    customerName: "FIXTURE — Northside Fitness",
    customerRef: "FIXTURE-CUST-2",
    segment: "trade",
    customerType: null,
    lines: [
      { sku: null, productName: "Helix Power Rack", category: "storage", qty: 1 },
      { sku: null, productName: "Lifting Platform / Platform Inserts / Ply", category: "flooring", qty: 4 },
      { sku: null, productName: "Club bench not on the table", category: "bench", qty: 1 },
    ],
  },
  {
    id: "fixture-quote-1003",
    number: "FIXTURE-Q-1003",
    customerName: "FIXTURE — City Athletic",
    customerRef: "FIXTURE-CUST-3",
    segment: "big_corporate",
    customerType: "leasing",
    lines: [
      { sku: null, productName: "DHZ selectorised machine — GENERIC PROVISIONAL", category: "strength-selectorised", qty: 1 },
    ],
  },
  {
    id: "fixture-quote-1004",
    number: "FIXTURE-Q-1004",
    customerName: "FIXTURE — Untagged Gym",
    customerRef: "FIXTURE-CUST-4",
    segment: null,
    customerType: "credit",
    lines: [{ sku: null, productName: "Concept2 RowErg", category: "cardio", qty: 3 }],
  },
  {
    id: "fixture-quote-490",
    number: "EXAMPLE-00490",
    customerName: "Example Sports Centre",
    customerRef: "EXAMPLE-CUST",
    segment: "independent",
    customerType: "proforma",
    postcode: "LS1 4DY",
    lines: [
      { sku: "TREAD-TFT", productName: "Jordan Elite TFT treadmills", category: "cardio", qty: 3, lineNet: 9135 },
      { sku: "RECUMBENT", productName: "Jordan Elite recumbent cardio bike", category: "cardio", qty: 1, lineNet: 1999 },
      { sku: "UPRIGHT", productName: "Jordan Elite upright cardio bike", category: "cardio", qty: 2, lineNet: 3757 },
      { sku: "AIRBIKE", productName: "Jordan Elite air bike - OEM unverified", category: "cardio", qty: 1, lineNet: 1115 },
      { sku: "ELLIP-TFT", productName: "Jordan Elite TFT ellipticals", category: "cardio", qty: 3, lineNet: 7232.99 },
      { sku: "C2-SKI", productName: "Concept2 SkiErg", category: "cardio", qty: 1, lineNet: 679.17 },
      { sku: "C2-ROW", productName: "Concept2 RowErg", category: "cardio", qty: 2, lineNet: 1650 },
      { sku: "DHZ-STRENGTH", productName: "Nine separate confirmed DHZ pin-loaded machines (aggregated for test only)", category: "strength", qty: 9, lineNet: 10459.03 },
      { sku: "J75-CABLE", productName: "J75 Cable Rack", category: "strength", qty: 1, lineNet: 2127.32 },
      { sku: "J75-POWER", productName: "J75 Compact Power Rack", category: "strength", qty: 1, lineNet: 2356.66 },
      { sku: "BENCH-FID", productName: "Adjustable strength bench", category: "bench", qty: 1, lineNet: 239.4 },
      { sku: "MISC-DHZ-1", productName: "DHZ item missing model 1", category: "strength", qty: 1, lineNet: 1523.31 },
      { sku: "MISC-DHZ-2", productName: "DHZ item missing model 2", category: "strength", qty: 1, lineNet: 1523.31 },
      { sku: "MISC-DHZ-3", productName: "DHZ item missing model 3", category: "strength", qty: 1, lineNet: 2450.74 },
      { sku: "OTHER-GOODS", productName: "Loose weights, stands, bars, accessories and plates (aggregated for test only)", category: "accessory", qty: 1, lineNet: 2818.6 },
    ],
  },
];

export function createFixtureCin7Client(): Cin7ReadClient {
  return {
    async listQuotes() {
      return FIXTURE_QUOTES.map((quote) => ({ ...quote, lines: quote.lines.map((line) => ({ ...line })) }));
    },
    async getQuote(id: string) {
      const found = FIXTURE_QUOTES.find((quote) => quote.id === id || quote.number === id);
      return found ? { ...found, lines: found.lines.map((line) => ({ ...line })) } : null;
    },
  };
}
