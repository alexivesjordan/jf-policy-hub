"use client";

import { useActionState } from "react";
import { generateServiceProposal, type ServiceQuoteView } from "@/features/sales/service-actions";
import { Banner, Button } from "@/components/pulse/ui";

function money(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

export function ServiceQuoteResult({
  service,
  installPrice,
}: {
  service: ServiceQuoteView;
  installPrice?: number | null;
}) {
  const sites = service.prices ?? [];
  return (
    <section className="space-y-4">
      {sites.map((site) => {
        const prices = site.prices;
        const rows = [
          ...(installPrice !== undefined ? [["Install price", installPrice] as const] : []),
          ["Annual maintenance", prices.annualPm] as const,
          ["Twice-yearly maintenance", prices.twiceYearlyPm] as const,
          ["5-year parts warranty, one-off", prices.extendedWarrantyOneOff] as const,
          ["Year 1 bundle · annual maintenance", prices.annualBundleYear1] as const,
          ["Year 1 bundle · twice-yearly maintenance", prices.twiceBundleYear1] as const,
        ];
        return (
          <div key={site.name} className="rounded-3xl border border-line bg-card px-6 py-6">
            <h2 className="font-display text-2xl">{sites.length > 1 ? site.name : "Maintenance and warranty"}</h2>
            <p className="mt-1 text-sm text-grey">{service.customerName} · {service.quoteNumber} · rate {service.rateVersion}</p>
            <dl className="mt-4 divide-y divide-border">
              {rows.map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="text-sm text-ink">{label}</dt>
                  <dd className="font-display text-2xl">{money(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
      {service.warnings.length > 0 ? (
        <ul className="space-y-2">
          {service.warnings.map((warning) => <li key={warning}><Banner tone="warning">{warning}</Banner></li>)}
        </ul>
      ) : null}
      {service.flags ? (
        <div className="rounded-3xl border border-line bg-card px-6 py-5">
          <h3 className="font-display text-xl">Flags</h3>
          {service.flags.length === 0 ? <p className="mt-2 text-sm text-grey">No flags on this quote.</p> : (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{service.flags.map((flag) => <li key={flag}>{flag}</li>)}</ul>
          )}
          {service.audit ? (
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4"><dt>Goods net from lines</dt><dd>{money(service.audit.goodsNetFromLines)}</dd></div>
              <div className="flex justify-between gap-4"><dt>Goods net difference</dt><dd>{service.audit.goodsNetDiscrepancy == null ? "—" : money(service.audit.goodsNetDiscrepancy)}</dd></div>
              {service.audit.assumptions.length > 0 ? (
                <div>
                  <dt className="font-semibold">Audit notes</dt>
                  <dd className="mt-1 text-grey">{service.audit.assumptions.join(" ")}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function ProposalButton({ quoteId }: { quoteId: string | null }) {
  const [state, action, pending] = useActionState(generateServiceProposal, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="serviceQuoteId" value={quoteId ?? ""} />
      <Button type="submit" variant="secondary" disabled={pending || !quoteId}>{pending ? "Creating the proposal…" : "Generate proposal"}</Button>
      {pending ? <p role="status" className="text-sm text-grey">Creating the Word document. It is not created until you press the button.</p> : null}
      {state && !state.ok ? <Banner tone="error">{state.message}</Banner> : null}
      {state?.downloadUrl ? (
        <p className="text-sm">
          <a className="font-semibold underline decoration-primary" href={state.downloadUrl}>Download the proposal</a>
          <span className="text-grey"> · the link lasts 10 minutes</span>
        </p>
      ) : null}
    </form>
  );
}
