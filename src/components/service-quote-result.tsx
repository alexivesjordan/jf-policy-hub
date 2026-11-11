"use client";

import { useActionState } from "react";
import { generateServiceProposal, type ServiceQuoteView } from "@/features/sales/service-actions";
import { Banner, Button } from "@/components/pulse/ui";
import type { QuoteFlag } from "@/lib/quotes/flags";

function money(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

function flagLine(flag: QuoteFlag) {
  const message = flag.message.replace(/\s+/g, " ").trim();
  if (flag.code === "cin7_totals_mismatch" && flag.difference != null) {
    return `${message} Difference ${money(flag.difference)}.`;
  }
  return message;
}

function plainAssumption(note: string) {
  if (/\b1\.30\b|risk formula|extension factor/i.test(note)) return "";
  return note
    .replace("are not in the warranty eligible value", "are not included in the warranty value")
    .replace("eligible parts only", "qualifying parts only");
}

export function ServiceQuoteResult({
  service,
  installPrice,
}: {
  service: ServiceQuoteView;
  installPrice?: number | null;
}) {
  const sites = service.prices ?? [];
  const flags = [...new Map(service.flags.map((flag) => [`${flag.code}:${flag.message}`, flagLine(flag)])).values()]
    .filter((line) => line && !/\b1\.30\b|risk formula/i.test(line));
  const auditNotes = (service.audit?.assumptions ?? []).map(plainAssumption).filter(Boolean);
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
      {(service.deliveryInstall ?? []).length > 0 ? (
        <div className="rounded-3xl border border-line bg-card px-6 py-5">
          <h3 className="font-display text-xl">Delivery and install</h3>
          <p className="mt-1 text-sm text-grey">Used to check the order total. Not included in maintenance, the warranty, or a bundle.</p>
          <dl className="mt-3 space-y-2 text-sm">
            {(service.deliveryInstall ?? []).map((line) => (
              <div key={`${line.description}-${line.amountNet}`} className="flex justify-between gap-4">
                <dt>{line.description}</dt>
                <dd>{money(line.amountNet)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      <div className="rounded-3xl border border-line bg-card px-6 py-5">
        <h3 className="font-display text-xl">Things that may affect this price</h3>
        {flags.length === 0 ? <p className="mt-2 text-sm text-grey">No flags on this quote.</p> : (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{flags.map((flag) => <li key={flag}>{flag}</li>)}</ul>
        )}
        {service.audit ? (
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-4"><dt>Total of the product lines</dt><dd>{money(service.audit.goodsNetFromLines)}</dd></div>
            <div className="flex justify-between gap-4"><dt>Difference from the order total</dt><dd>{service.audit.goodsNetDiscrepancy == null ? "The order total was not on the quote" : money(service.audit.goodsNetDiscrepancy)}</dd></div>
            {auditNotes.length > 0 ? (
              <div>
                <dt className="font-semibold">Audit notes</dt>
                <dd className="mt-1 text-grey">{auditNotes.join(" ")}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>
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
