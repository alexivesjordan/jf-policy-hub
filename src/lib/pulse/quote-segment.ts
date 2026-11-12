const SEGMENTS = ["independent", "franchisee", "trade", "big_corporate"] as const;

export type SalesSegment = (typeof SEGMENTS)[number];

export function isSalesSegment(value: string): value is SalesSegment {
  return (SEGMENTS as readonly string[]).includes(value);
}

/**
 * The rep's choice wins. Otherwise the quote, then the segment remembered for
 * that customer. An empty result means the page must ask.
 */
export function resolveQuoteSegment(input: { quoteSegment: string; remembered: string; chosen: string }) {
  const chosen = input.chosen.trim();
  const quoteSegment = input.quoteSegment.trim();
  const remembered = input.remembered.trim();
  if (isSalesSegment(chosen)) {
    return { segment: chosen, needsChoice: false, remember: chosen !== remembered };
  }
  if (isSalesSegment(quoteSegment)) {
    return { segment: quoteSegment, needsChoice: false, remember: false };
  }
  if (isSalesSegment(remembered)) {
    return { segment: remembered, needsChoice: false, remember: false };
  }
  return { segment: "" as const, needsChoice: true, remember: false };
}

/** Real failures only. Asking for a segment is a control, not an error. */
export function quoteFailureText(result: { ok: boolean; needsSegment?: boolean; message?: string } | null) {
  if (!result || result.ok || result.needsSegment) return null;
  const message = result.message?.trim();
  return message || "Could not price that order.";
}

/** The sales page returns the price. Flags, lines, and the build stay off this object. */
export function salesInstallResult(view: {
  customerPrice: number | null;
  quoteNumber: string;
  customerName: string;
  postcode: string;
}) {
  return {
    customerPrice: view.customerPrice,
    quoteNumber: view.quoteNumber,
    customerName: view.customerName,
    postcode: view.postcode,
    showCost: false as const,
  };
}
