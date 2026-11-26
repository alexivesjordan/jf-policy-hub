import { formatGbp } from "@/features/logistics/landed-cost/money";
import type { QuoteView } from "@/features/logistics/landed-cost/quote";

export const fieldClass = "mt-1 w-full rounded-xl border border-line bg-field px-3 py-2 text-ink outline-none";
export const labelClass = "block text-sm font-semibold";
export const primaryClass = "rounded-xl bg-red px-4 py-2 font-semibold text-white disabled:opacity-60";
export const secondaryClass = "rounded-xl border border-line px-4 py-2 font-semibold";

export function LandedResult({ quote }: { quote: QuoteView }) {
  const rows: [string, string][] = [
    ["Commodity", quote.commodityCode],
    ["Customs value", formatGbp(quote.customsValuePence)],
    [quote.dutyLabel, `${formatGbp(quote.dutyPence)} · ${quote.dutyPercent.toFixed(2)}%`],
    ...quote.additional.map((line) => [line.label, `${formatGbp(line.pence)} · ${line.percent.toFixed(2)}%`] as [string, string]),
    ["VAT", `${formatGbp(quote.vatPence)} · ${quote.vatPercent.toFixed(2)}%`],
    ["Other charges", formatGbp(quote.otherChargesPence)],
  ];
  return (
    <section className="rounded-3xl border border-line bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">Landed cost</p>
        {quote.estimate ? <span className="rounded-full border border-line px-2 py-0.5 text-xs font-semibold">Estimate</span> : null}
      </div>
      <p className="mt-1 font-display text-4xl tabular-nums">{formatGbp(quote.landedPence)}</p>
      {quote.perUnitPence != null ? <p className="mt-1 text-sm font-semibold tabular-nums">{formatGbp(quote.perUnitPence)} per unit</p> : null}
      <dl className="mt-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 border-b border-line py-2 text-sm">
            <dt>{label}</dt>
            <dd className="text-right font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {quote.stale ? <p role="alert" className="mt-3 text-sm font-semibold">Tariff service unavailable.</p> : null}
      {quote.quotaAvailable ? <p className="mt-2 text-sm font-semibold">Quota available</p> : null}
      {quote.exporterSpecific ? <p className="mt-2 text-sm font-semibold">Exporter-specific duty</p> : null}
      {quote.rateSource === "manual" ? <p className="mt-3 text-xs text-grey">Manual {quote.unitsPerGbp} per £1</p> : null}
      {quote.rateSource === "hmrc" ? <p className="mt-3 text-xs text-grey">HMRC {quote.unitsPerGbp} per £1{quote.ratePeriod ? ` · ${quote.ratePeriod}` : ""}</p> : null}
    </section>
  );
}
