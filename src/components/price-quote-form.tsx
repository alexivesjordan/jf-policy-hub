"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Banner, Button, Field, Input, Select } from "@/components/ui";
import { priceFixtureQuote, type PricedQuote } from "@/features/operations/price-actions";

export function PriceQuoteForm({
  quotes,
}: {
  quotes: { id: string; number: string; customerName: string }[];
}) {
  const [state, action, pending] = useActionState(priceFixtureQuote, null);
  const quote = (state as { quote?: PricedQuote } | null)?.quote;

  return (
    <div className="space-y-6">
      <form action={action} className="grid gap-4 md:grid-cols-2">
        <Field label="Fixture quote">
          <Select name="quoteId" required defaultValue={quotes[0]?.id}>
            {quotes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.number} — {item.customerName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Site postcode">
          <Input name="postcode" required placeholder="NR1 1AA" autoCapitalize="characters" />
        </Field>
        <div className="md:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Pricing..." : "Price best case"}
          </Button>
        </div>
      </form>
      {state ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
      {quote?.notice ? (
        <blockquote className="rounded-3xl border border-red bg-card px-5 py-4 text-sm leading-6 text-white">
          {quote.notice}
        </blockquote>
      ) : null}
      {quote && quote.customerPrice != null ? (
        <div className="rounded-3xl border border-line bg-card px-5 py-4">
          <p className="text-sm text-grey">{quote.quoteNumber} · {quote.postcode}</p>
          <p className="font-display mt-2 text-4xl">
            {new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(quote.customerPrice)}
          </p>
          <p className="mt-2 text-sm text-grey">Customer price ex VAT · {quote.finality === "final" ? "Final for best-case access" : "Provisional"}</p>
          <p className="mt-3 text-sm text-white/80">{quote.paymentGate}</p>
          {quote.showCost ? (
            <div className="mt-4 space-y-1 border-t border-line pt-4 text-sm text-grey">
              <p>Internal cost {quote.cost == null ? "—" : `£${quote.cost.toFixed(2)}`}</p>
              <p>Markup {quote.markup == null ? "—" : `${Math.round(quote.markup * 1000) / 10}%`}</p>
              <p>Minimum job charge {quote.minJobChargeConfigured ? "applied when higher" : "Not configured"}</p>
              <p>Margin floor {quote.marginFloorConfigured && quote.marginFloorPrice != null ? `£${quote.marginFloorPrice.toFixed(2)}` : "Not configured"}</p>
              {quote.provisionalItems && quote.provisionalItems.length > 0 ? (
                <p>Provisional: {quote.provisionalItems.join("; ")}</p>
              ) : null}
            </div>
          ) : null}
          {quote.jobId ? (
            <Link href={`/operations/jobs/${quote.jobId}`} className="mt-4 inline-block text-sm font-semibold text-white underline decoration-red">
              Open the job
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
