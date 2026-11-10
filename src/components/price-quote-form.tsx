"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { PriceWorkings } from "@/components/price-workings";
import { Banner, Button, Field, Input, Select } from "@/components/ui";
import {
  createPricedJob,
  loadFixtureQuote,
  parseUploadedQuote,
  priceReviewedQuote,
  type PricedQuote,
  type QuoteDraft,
} from "@/features/operations/price-actions";

const SEGMENTS = [
  ["independent", "Independent"],
  ["franchisee", "Franchisee"],
  ["trade", "Trade"],
  ["big_corporate", "Big corporate"],
] as const;

export function PriceQuoteForm({
  categories,
}: {
  categories: string[];
}) {
  const [loaded, loadQuote, loading] = useActionState(loadFixtureQuote, null);
  const [parsed, parsePdf, parsing] = useActionState(parseUploadedQuote, null);
  const [priced, priceQuote, pricing] = useActionState(priceReviewedQuote, null);
  const [created, createJob, creating] = useActionState(createPricedJob, null);
  const [draft, setDraft] = useState<QuoteDraft | null>(null);
  const [sourceName, setSourceName] = useState<"load" | "pdf" | null>(null);

  useEffect(() => {
    if (loaded?.draft) {
      setSourceName("load");
      setDraft(structuredClone(loaded.draft));
    }
  }, [loaded]);

  useEffect(() => {
    if (parsed?.draft) {
      setSourceName("pdf");
      setDraft(structuredClone(parsed.draft));
    }
  }, [parsed]);

  const quote = (created?.quote ?? priced?.quote) as PricedQuote | undefined;
  const notice = sourceName === "pdf" ? parsed : sourceName === "load" ? loaded : null;

  return (
    <div className="space-y-6">
      <form action={loadQuote} className="grid gap-4 md:grid-cols-[1fr_auto]">
        <Field label="Cin7 quote number" hint="Fixture numbers such as FIXTURE-Q-1001. A live number is not fetched until Cin7 is connected.">
          <Input name="quoteNumber" placeholder="FIXTURE-Q-1001" />
        </Field>
        <div className="md:pt-7">
          <Button type="submit" disabled={loading}>{loading ? "Loading..." : "Load quote"}</Button>
        </div>
      </form>
      <form action={parsePdf} className="grid gap-4 md:grid-cols-[1fr_auto]">
        <Field label="Or upload the quote PDF" hint="Text is extracted in the app. The file is not stored.">
          <Input name="quotePdf" type="file" accept="application/pdf,.pdf" />
        </Field>
        <div className="md:pt-7">
          <Button type="submit" variant="secondary" disabled={parsing}>{parsing ? "Reading..." : "Read PDF"}</Button>
        </div>
      </form>

      {notice && !draft ? <Banner tone={notice.ok ? "success" : "error"}>{notice.message}</Banner> : null}

      {draft ? (
        <form action={priceQuote} className="space-y-4">
          <input type="hidden" name="source" value={draft.source} />
          <input type="hidden" name="quoteNumber" value={draft.quoteNumber} />
          <input type="hidden" name="customerReference" value={draft.customerReference} />
          <input type="hidden" name="goodsNet" value={draft.goodsNet ?? ""} />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Customer">
              <Input name="customerName" value={draft.customerName} onChange={(event) => setDraft({ ...draft, customerName: event.target.value })} required />
            </Field>
            <Field label="Site postcode">
              <Input name="postcode" value={draft.postcode} onChange={(event) => setDraft({ ...draft, postcode: event.target.value })} required autoCapitalize="characters" />
            </Field>
            <Field label="Segment" hint="Cin7 Core quotes do not include a segment. Pricing stays blocked until you choose one.">
              <Select name="segment" required value={draft.segment} onChange={(event) => setDraft({ ...draft, segment: event.target.value })}>
                <option value="">Choose a segment</option>
                {SEGMENTS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </Field>
          </div>
          {draft.warnings.map((warning) => (
            <Banner key={warning} tone="warning">{warning}</Banner>
          ))}
          <div className="overflow-x-auto rounded-3xl border border-line">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead>
                <tr className="text-left text-grey">
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Line total</th>
                </tr>
              </thead>
              <tbody>
                {draft.lines.map((line, index) => (
                  <tr key={`${line.sku}-${index}`} className="border-t border-line">
                    <td className="px-3 py-2">
                      <input type="hidden" name="lineSku" value={line.sku} />
                      <span className="font-mono text-xs text-ink">{line.sku || "—"}</span>
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        name="lineDescription"
                        value={line.description}
                        onChange={(event) => updateLine(setDraft, draft, index, { description: event.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        name="lineQty"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={line.qty}
                        onChange={(event) => updateLine(setDraft, draft, index, { qty: Number(event.target.value) })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Select
                        name="lineCategory"
                        value={line.category}
                        onChange={(event) => updateLine(setDraft, draft, index, { category: event.target.value })}
                      >
                        <option value="">Match by name</option>
                        {categories.map((category) => (
                          <option key={category} value={category}>{category}</option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-3 py-2 text-ink">
                      <input type="hidden" name="lineTotal" value={line.lineTotal ?? ""} />
                      {line.lineTotal == null ? "—" : line.lineTotal.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pricing}>{pricing ? "Pricing..." : "Price best case"}</Button>
            {priced?.ok ? (
              <Button type="submit" formAction={createJob} variant="secondary" disabled={creating}>
                {creating ? "Creating..." : "Create job"}
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}

      {draft && (priced || created) ? <Banner tone={(created ?? priced)?.ok ? "success" : "error"}>{(created ?? priced)?.message}</Banner> : null}
      {quote?.showCost && quote.breakdown && quote.customerPrice != null ? (
        <PriceWorkings
          breakdown={quote.breakdown}
          notice={quote.notice}
          customerPrice={quote.customerPrice}
          segment={quote.segment ?? null}
          markup={quote.markup ?? null}
        />
      ) : quote?.notice ? <blockquote className="rounded-3xl border border-red bg-card px-5 py-4 text-sm leading-6 text-ink">{quote.notice}</blockquote> : null}
      {quote?.warnings.map((warning) => <Banner key={warning} tone="warning">{warning}</Banner>)}
      {quote?.requirements ? (
        <div className="rounded-3xl border border-line bg-card px-5 py-4 text-sm text-ink">
          <p className="font-semibold">Required resources</p>
          <p className="mt-2 text-grey">Set by the pricer. A sales rep cannot edit these.</p>
          <ul className="mt-3 space-y-1">
            <li>{quote.requirements.installers} installer{quote.requirements.installers === 1 ? "" : "s"}</li>
            <li>{quote.requirements.licensedDrivers} licensed driver{quote.requirements.licensedDrivers === 1 ? "" : "s"}</li>
            <li>{quote.requirements.vanCount} {quote.requirements.vanSize === "crafter" ? "Crafter" : "small van"}{quote.requirements.vanCount === 1 ? "" : "s"}</li>
            <li>Stair climber {quote.requirements.stairClimber ? "yes" : "no"}</li>
          </ul>
        </div>
      ) : null}
      {quote && quote.customerPrice != null && !quote.breakdown ? (
        <div className="rounded-3xl border border-line bg-card px-5 py-4">
          <p className="text-sm text-grey">{quote.quoteNumber} · {quote.postcode}</p>
          <p className="font-display mt-2 text-4xl">
            {new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(quote.customerPrice)}
          </p>
          <p className="mt-2 text-sm text-grey">Customer price ex VAT · {quote.finality === "final" ? "Final for best-case access" : "Provisional"}</p>
          {quote.showCost ? (
            <div className="mt-4 space-y-1 border-t border-line pt-4 text-sm text-grey">
              <p>Internal cost {quote.cost == null ? "—" : `£${quote.cost.toFixed(2)}`}</p>
              <p>Markup {quote.markup == null ? "—" : `${Math.round(quote.markup * 1000) / 10}%`}</p>
            </div>
          ) : null}
          {quote.jobId ? (
            <Link href={`/operations/jobs/${quote.jobId}/schedule`} className="mt-4 inline-block text-sm font-semibold text-ink underline decoration-red">
              Pencil a day
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function updateLine(
  setDraft: (draft: QuoteDraft) => void,
  draft: QuoteDraft,
  index: number,
  patch: Partial<QuoteDraft["lines"][number]>,
) {
  setDraft({
    ...draft,
    lines: draft.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
  });
}
