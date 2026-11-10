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
