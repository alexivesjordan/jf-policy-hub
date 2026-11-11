import { requireSalesUser } from "@/lib/auth";

export const metadata = { title: "Warranties and servicing" };

/**
 * Access gate for Sales. Juno builds the screen against:
 * loadServiceFromOrder, loadServiceFromPdf, priceServiceQuote,
 * saveServiceRates, saveClassificationRule, generateServiceProposal
 * in src/features/sales/service-actions.ts.
 */
export default async function ServiceQuotePage() {
  await requireSalesUser();
  return (
    <div className="space-y-3">
      <h1 className="font-display text-4xl">Warranties and servicing</h1>
      <p className="max-w-2xl text-ink/70">
        Reps can price proactive maintenance and the five-year parts extension from a Cin7 order or a quote PDF. The Word proposal is created only when someone asks for it.
      </p>
    </div>
  );
}
