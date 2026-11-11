/**
 * Maintenance and warranty lines beside an install price.
 * Values stay empty until the service-quote API is connected.
 */
export type ServiceQuoteLines = {
  source: "placeholder";
  annualMaintenance: number | null;
  twiceYearlyMaintenance: number | null;
  partsWarranty5Year: number | null;
  year1AnnualBundle: number | null;
  year1TwiceYearlyBundle: number | null;
};

export function serviceQuotePlaceholder(): ServiceQuoteLines {
  return {
    source: "placeholder",
    annualMaintenance: null,
    twiceYearlyMaintenance: null,
    partsWarranty5Year: null,
    year1AnnualBundle: null,
    year1TwiceYearlyBundle: null,
  };
}
