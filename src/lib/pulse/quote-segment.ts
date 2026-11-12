const SEGMENTS = ["independent", "franchisee", "trade", "big_corporate"] as const;

export type SalesSegment = (typeof SEGMENTS)[number];

export function isSalesSegment(value: string): value is SalesSegment {
  return (SEGMENTS as readonly string[]).includes(value);
}

/** The rep's choice is the segment. It replaces whatever was stored for that customer. */
export function resolveQuoteSegment(chosen: string) {
  const segment = chosen.trim();
  if (!isSalesSegment(segment)) return { segment: "" as const, needsChoice: true, remember: false };
  return { segment, needsChoice: false, remember: true };
}

export function canLoadQuote(orderNumber: string, segment: string) {
  return orderNumber.trim().length > 0 && isSalesSegment(segment);
}

/** Real failures only. Asking for a segment is a control, not an error. */
export function quoteFailureText(result: { ok: boolean; message?: string } | null) {
  if (!result || result.ok) return null;
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

type ServicePrice = {
  annualPm: number;
  twiceYearlyPm: number;
  extendedWarrantyOneOff: number;
  annualBundleYear1: number | null;
  twiceBundleYear1: number | null;
};

/** Fields the install quote page actually draws. Anything else on the input is dropped. */
export function salesOrderActionResult(input: {
  ok: boolean;
  message: string;
  needsSegment: boolean;
  quoteNumber: string;
  customerName: string;
  postcode: string;
  customerPrice: number | null;
  savedQuoteId?: string;
  service?: {
    id: string | null;
    quoteNumber: string;
    customerName: string;
    rateVersion: string;
    prices?: { name: string; prices?: Partial<ServicePrice> | null }[] | null;
  } | null;
}) {
  const service = input.service
    ? {
        id: input.service.id,
        quoteNumber: input.service.quoteNumber,
        customerName: input.service.customerName,
        rateVersion: input.service.rateVersion,
        prices: (input.service.prices ?? []).map((site) => ({
          name: site.name,
          prices: {
            annualPm: site.prices?.annualPm ?? 0,
            twiceYearlyPm: site.prices?.twiceYearlyPm ?? 0,
            extendedWarrantyOneOff: site.prices?.extendedWarrantyOneOff ?? 0,
            annualBundleYear1: site.prices?.annualBundleYear1 ?? null,
            twiceBundleYear1: site.prices?.twiceBundleYear1 ?? null,
          },
        })),
      }
    : null;
  return {
    ok: input.ok,
    message: input.message,
    needsSegment: input.needsSegment,
    quoteNumber: input.quoteNumber,
    customerName: input.customerName,
    quote: input.needsSegment
      ? undefined
      : {
          customerPrice: input.customerPrice,
          quoteNumber: input.quoteNumber,
          customerName: input.customerName,
          postcode: input.postcode,
          savedQuoteId: input.savedQuoteId,
          service,
        },
  };
}
