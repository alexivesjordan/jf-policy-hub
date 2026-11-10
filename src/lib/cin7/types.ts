export type Cin7CustomerType = "credit" | "proforma" | "leasing" | null;
export type Cin7Segment = "independent" | "franchisee" | "trade" | "big_corporate" | null;

/** A quote as Orbit needs it. Field names are ours. They are not a Cin7 payload map. */
export type Cin7QuoteLine = {
  sku: string | null;
  productName: string;
  category: string | null;
  qty: number;
};

export type Cin7Quote = {
  id: string;
  number: string;
  customerName: string;
  customerRef: string;
  segment: Cin7Segment;
  customerType: Cin7CustomerType;
  lines: Cin7QuoteLine[];
};

/**
 * Read-only Cin7 Core surface. The live adapter, when a key exists, may only
 * call a GET allowlist. This interface has no write methods.
 */
export interface Cin7ReadClient {
  listQuotes(): Promise<Cin7Quote[]>;
  getQuote(id: string): Promise<Cin7Quote | null>;
}
