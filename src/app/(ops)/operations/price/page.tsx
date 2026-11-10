import { PriceQuoteForm } from "@/components/price-quote-form";
import { requireOperationsUser } from "@/lib/auth";
import { loadBundledEffortTable } from "@/lib/pricer/effort-table";

export const metadata = { title: "Price a quote" };

export default async function PricePage() {
  await requireOperationsUser();
  const categories = [...new Set(loadBundledEffortTable().map((row) => row.category))].sort();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-grey">Mode A · fixture adapter</p>
        <h1 className="font-display mt-2 text-4xl">Price a quote</h1>
        <p className="mt-2 max-w-2xl text-ink/70">
          Load a fixture quote number, or upload a Cin7 Core quote PDF. Pricing does not create a job. The PDF parser is deterministic and can be swapped for another extractor later.
        </p>
      </div>
      <PriceQuoteForm categories={categories} />
    </div>
  );
}
