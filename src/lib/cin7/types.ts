export type Cin7CustomerType = "credit" | "proforma" | "leasing" | null;
export type Cin7Segment = "independent" | "franchisee" | "trade" | "big_corporate" | null;

/** A quote as Pulse needs it. Field names are ours. They are not a Cin7 payload map. */
export type Cin7QuoteLine = {
  sku: string | null;
  productName: string;
  category: string | null;
  /** Cin7 product Category text. Not a Pulse category slug. */
  cin7Category?: string | null;
  /** Cin7 ProductID from the sale line. */
  productId?: string | null;
  qty: number;
  /** Product.Weight when Cin7 reports kilograms. */
  unitWeightKg?: number | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  /** Present only when Cin7 sends DimensionsUnits. Otherwise the unit is unknown. */
  dimensionUnit?: string | null;
  uom?: string | null;
  tilesPerPack?: number | null;
};

export type Cin7Quote = {
  id: string;
  number: string;
  customerName: string;
  customerRef: string;
  segment: Cin7Segment;
  customerType: Cin7CustomerType;
  postcode?: string | null;
  /** Cin7 CustomerID. Not a name or address. */
  customerId?: string | null;
  lines: Cin7QuoteLine[];
  /** Order lines were empty, so quote lines were used. */
  usedQuoteLines?: boolean;
  /** A positive weight was ignored because it was not in kilograms. */
  weightIgnored?: boolean;
};

/**
 * Read-only Cin7 Core surface. The live adapter, when a key exists, may only
 * call a GET allowlist. This interface has no write methods.
 */
export interface Cin7ReadClient {
  listQuotes(): Promise<Cin7Quote[]>;
  getQuote(id: string): Promise<Cin7Quote | null>;
}
