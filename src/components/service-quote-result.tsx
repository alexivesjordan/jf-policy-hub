import { serviceQuotePlaceholder } from "@/lib/sales/service-quote";

function money(value: number | null) {
  if (value == null) return "Not connected";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

export function ServiceQuoteResult({ installPrice }: { installPrice: number | null }) {
  const lines = serviceQuotePlaceholder();
  const rows = [
    ["Install price", installPrice],
    ["Annual maintenance", lines.annualMaintenance],
    ["Twice-yearly maintenance", lines.twiceYearlyMaintenance],
    ["5-year parts warranty, one-off", lines.partsWarranty5Year],
    ["Year 1 bundle · annual maintenance", lines.year1AnnualBundle],
    ["Year 1 bundle · twice-yearly maintenance", lines.year1TwiceYearlyBundle],
  ] as const;

  return (
    <section className="rounded-3xl border border-line bg-card px-6 py-6">
      <h2 className="font-display text-2xl">Install, maintenance and warranty</h2>
      <p className="mt-2 text-sm text-grey">Maintenance and warranty prices are not connected yet. The install price above is the only live figure.</p>
      <dl className="mt-4 divide-y divide-border">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 py-3">
            <dt className="text-sm text-ink">{label}</dt>
            <dd className={value == null ? "text-sm text-grey" : "font-display text-2xl"}>{money(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
