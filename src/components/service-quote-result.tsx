"use client";

import { useActionState } from "react";
import { generateServiceProposal, type ServiceQuoteView } from "@/features/sales/service-actions";
import { Banner, Button } from "@/components/pulse/ui";

function money(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

function plainFlag(flag: string) {
  const text = flag.replace(/\bFIXTURE\s*[—–-]\s*/gi, "");
  if (/no eligible\/provisionally eligible component value/i.test(text)) {
    return "No kit on this order qualifies for the parts warranty, so it can't be priced automatically.";
  }
  if (/zero identified serviceable units/i.test(text)) {
    return "No machines on this order can be put on a maintenance visit, so that price can't be set automatically.";
  }
  if (/Goods Net not provided/i.test(text)) {
    return "The order total was not on the quote, so we could not check that every line was included.";
  }
  if (/GOODS NET RECONCILIATION/i.test(text)) {
    return text
      .replace(/GOODS NET RECONCILIATION:\s*/i, "")
      .replace(/quoted £([0-9,.]+)/i, "The order total was £$1")
      .replace(/transcribed lines £([0-9,.]+)/i, "the lines add up to £$1")
      .replace(/discrepancy £([0-9,.]+)/i, "which is £$1 different")
      .replace(/Check quote pages before final approval\./i, "Check the quote before this price is sent.");
  }
  if (/Identity and actual number of machines|does not name a model|Provisional DHZ/i.test(text)) {
    return "The model is not named. This is a provisional allowance only, and parts cover is not promised.";
  }
  if (/Cardio OEM|cardio model is not confirmed|cardio model needs confirming/i.test(text)) {
    return "The cardio model needs confirming before a warranty is offered.";
  }
  if (/Third-party|unclear cardio/i.test(text)) {
    return "This looks like another brand of cardio. Maintenance is priced. The five-year warranty waits for written approval.";
  }
  if (/Rack\/functional trainer|Rack and trainer/i.test(text)) {
    return "Rack and trainer parts cover is provisional until the model is confirmed.";
  }
  if (/Product identity cannot be established/i.test(text)) {
    return "This product cannot be identified from the quote, so it is left out of the automatic price.";
  }
  if (/manual rate\/category override/i.test(text)) {
    return "A manual category needs a written note before it can be used.";
  }
  if (/Bundle and portfolio discount needs management approval/i.test(text)) {
    return "This quote covers more than one site. The bundle and portfolio discount needs management approval.";
  }
  return text.replace(/^[^:]+:\s*/, "").replace(/\s+/g, " ").trim();
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
  const missingLinePrices = service.warnings.some((warning) => /line net/i.test(warning));
  const flags = [...new Set([
    ...(missingLinePrices ? ["Some lines did not include a price, so they were counted at £0. Upload the quote PDF to price them."] : []),
    ...service.flags.map(plainFlag),
  ].filter((flag) => flag && !/\b1\.30\b|risk formula/i.test(flag)))];
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
      <div className="rounded-3xl border border-line bg-card px-6 py-5">
        <h3 className="font-display text-xl">Things that may affect this price</h3>
        {flags.length === 0 ? <p className="mt-2 text-sm text-grey">No flags on this quote.</p> : (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{flags.map((flag) => <li key={flag}>{flag}</li>)}</ul>
        )}
        {service.audit ? (
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-4"><dt>Total of the lines</dt><dd>{money(service.audit.goodsNetFromLines)}</dd></div>
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
