import type { QuoteFlag } from "@/lib/quotes/flags";

export type Cin7CustomerType = "credit" | "proforma" | "leasing" | null;
export type Cin7Segment = "independent" | "franchisee" | "trade" | "big_corporate" | null;

/** A quote as Pulse needs it. Field names are ours. They are not a Cin7 payload map. */
export type Cin7QuoteLine = {
  sku: string | null;
  /** Cin7 sale-line ID when the payload has one. */
  lineId?: string | null;
  productName: string;
  category: string | null;
  /** Cin7 product Category text. Not a Pulse category slug. */
  cin7Category?: string | null;
  /** Cin7 ProductID from the sale line. */
  productId?: string | null;
  qty: number;
  /** Line net ex VAT after checking Total against the order totals. Null when that check fails. */
  lineNet?: number | null;
  /** Product.Weight when Cin7 reports kilograms. */
  unitWeightKg?: number | null;
  /** Product.HSCode, normalised to 6–10 digits and padded to 10. Null when Cin7 has none. */
  hsCode?: string | null;
  /** ISO 3166-1 alpha-2. Taken from Product.CountryOfOrigin or CountryOfOriginCode. */
  originCountry?: string | null;
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
  currency?: string | null;
  buyerAddress?: string | null;
  consigneeAddress?: string | null;
  destinationCountry?: string | null;
  /** Delivery-address city, used to build the Incoterms named place. */
  deliveryCity?: string | null;
  /** Cin7 CustomerID. Not a name or address. */
  customerId?: string | null;
  /** Sale Contact, or the customer's default contact name. */
  contactName?: string | null;
  /** Sale Email, or the customer's default contact email. */
  contactEmail?: string | null;
  /** Sale Carrier, mapped from a known code, otherwise the customer Carrier name. */
  courier?: string | null;
  /** Customer TaxNumber. Empty when Cin7 has none. */
  buyerVat?: string | null;
  lines: Cin7QuoteLine[];
  /** Order lines were empty, so quote lines were used. */
  usedQuoteLines?: boolean;
  /** A positive weight was ignored because it was not in kilograms. */
  weightIgnored?: boolean;
  /** Additional charges from the same Order or Quote section as the lines. Ex VAT. */
  additionalCharges?: { description: string; amountNet: number }[];
  /** Cin7 ShippingNotes. Empty when the order has none. */
  specialInstructions?: string;
  /** Line Total matched the tax-inclusive order total, so Tax was removed. */
  taxStripped?: boolean;
  /** Money checks. Select these by code; do not match the message text. */
  moneyFlags?: QuoteFlag[];
};

/**
 * Read-only Cin7 Core surface. The live adapter, when a key exists, may only
 * call a GET allowlist. This interface has no write methods.
 */
export interface Cin7ReadClient {
  listQuotes(): Promise<Cin7Quote[]>;
  getQuote(id: string): Promise<Cin7Quote | null>;
}
