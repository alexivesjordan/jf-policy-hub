function money(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

export type ServiceQuoteDisplay = {
  customerName: string;
  quoteNumber: string;
  rateVersion: string;
  prices: {
    name: string;
    prices: {
      annualPm: number;
      twiceYearlyPm: number;
      extendedWarrantyOneOff: number;
      annualBundleYear1: number | null;
      twiceBundleYear1: number | null;
    };
  }[];
};

export function ServiceQuoteResult({
  service,
  installPrice,
}: {
  service: ServiceQuoteDisplay;
  installPrice?: number | null;
}) {
  const sites = service.prices ?? [];
  return (
    <section className="space-y-4">
      {sites.map((site) => {
        const prices = site.prices;
        const warrantyReady = prices.extendedWarrantyOneOff > 0;
        const rows: { label: string; value: string }[] = [];
        if (installPrice !== undefined) rows.push({ label: "Install price", value: money(installPrice) });
        rows.push({ label: "Annual maintenance", value: money(prices.annualPm) });
        rows.push({ label: "Twice-yearly maintenance", value: money(prices.twiceYearlyPm) });
        if (warrantyReady) {
          rows.push({ label: "5-year parts warranty, one-off", value: money(prices.extendedWarrantyOneOff) });
          rows.push({ label: "Year 1 bundle · annual maintenance", value: money(prices.annualBundleYear1) });
          rows.push({ label: "Year 1 bundle · twice-yearly maintenance", value: money(prices.twiceBundleYear1) });
        }
        return (
          <div key={site.name} className="rounded-3xl border border-line bg-card px-6 py-6">
            <h2 className="font-display text-2xl">{sites.length > 1 ? site.name : "Maintenance and warranty"}</h2>
            <p className="mt-1 text-sm text-grey">{service.customerName.replace(/^FIXTURE\s*[—–-]\s*/i, "")} · {service.quoteNumber} · rate {service.rateVersion}</p>
            <dl className="mt-4 divide-y divide-border">
              {rows.map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="text-sm text-ink">{row.label}</dt>
                  <dd className="font-display text-2xl">{row.value}</dd>
                </div>
              ))}
            </dl>
            {!warrantyReady ? (
              <p className="mt-4 text-sm text-grey">Not available for this order. Our team will confirm the warranty price.</p>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
