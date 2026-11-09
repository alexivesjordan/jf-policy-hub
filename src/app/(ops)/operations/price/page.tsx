import { PriceQuoteForm } from "@/components/price-quote-form";
import { getCin7Client } from "@/lib/cin7/client";
import { requireOperationsUser } from "@/lib/auth";

export const metadata = { title: "Price a quote" };

export default async function PricePage() {
  await requireOperationsUser();
  const quotes = await getCin7Client().listQuotes();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-grey">Mode A · fixture adapter</p>
        <h1 className="font-display mt-2 text-4xl">Price a quote</h1>
        <p className="mt-2 max-w-2xl text-white/70">
          These quotes are in-memory fixtures. SKUs are blank, so the pricer matches product names and category fallbacks. Nothing is sent to Cin7.
        </p>
      </div>
      <PriceQuoteForm
        quotes={quotes.map((quote) => ({
          id: quote.id,
          number: quote.number,
          customerName: quote.customerName,
        }))}
      />
    </div>
  );
}
