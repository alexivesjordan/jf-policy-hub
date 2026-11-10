"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { PriceWorkings } from "@/components/price-workings";
import { Banner, Button, Field, Input, Select } from "@/components/pulse/ui";
import { BookingModal } from "@/components/booking-modal";
import {
  createPricedJob,
  loadFixtureQuote,
  parseUploadedQuote,
  priceReviewedQuote,
  priceSalesOrder,
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
  cin7Connected,
  showInternal,
  canPreviewSales = false,
}: {
  cin7Connected: boolean;
  showInternal: boolean;
  canPreviewSales?: boolean;
}) {
  const [loaded, loadQuote, loading] = useActionState(loadFixtureQuote, null);
  const [parsed, parsePdf, parsing] = useActionState(parseUploadedQuote, null);
  const [priced, priceQuote, pricing] = useActionState(priceReviewedQuote, null);
  const [created, createJob, creating] = useActionState(createPricedJob, null);
  const [sold, sellOrder, selling] = useActionState(priceSalesOrder, null);
  const [bookingJob, setBookingJob] = useState<string | null>(null);
  const [segmentChoice, setSegmentChoice] = useState("");
  const [viewAsSales, setViewAsSales] = useState(false);
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

  useEffect(() => {
    if ((!showInternal || viewAsSales) && created?.quote?.jobId) setBookingJob(created.quote.jobId);
  }, [created, showInternal, viewAsSales]);

  const viewingSales = !showInternal || viewAsSales;
  const quote = (created?.quote ?? (viewingSales ? sold?.quote ?? priced?.quote : priced?.quote)) as PricedQuote | undefined;
  const notice = sourceName === "pdf" ? parsed : sourceName === "load" ? loaded : null;
  const salesDraft = sold?.draft ?? (viewingSales ? draft : null);
  const previewToggle = showInternal && canPreviewSales ? (
    <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-ink">
      <input
        type="checkbox"
        className="size-5 accent-red"
        checked={viewAsSales}
        onChange={(event) => setViewAsSales(event.target.checked)}
      />
      View as sales rep
    </label>
  ) : null;

  if (viewingSales) {
    const summary = quote?.repSummary;
    return (
      <div className="space-y-6">
        {previewToggle}
        <form action={sellOrder} className="space-y-4">
          <Field label="Cin7 sales order" hint={cin7Connected ? "For example SO-00490. A saved segment for this customer is used if you leave the segment blank." : "Fixture numbers such as FIXTURE-Q-1001 while Cin7 is not connected."}>
            <Input name="quoteNumber" placeholder={cin7Connected ? "SO-00490" : "FIXTURE-Q-1001"} />
          </Field>
          <Field label="Segment" hint="Leave this on the saved segment when this customer has been priced before.">
            <Select name="segment" value={segmentChoice} onChange={(event) => setSegmentChoice(event.target.value)}>
              <option value="">Use the saved segment</option>
              {SEGMENTS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </Field>
          <Button type="submit" disabled={selling || creating}>{selling ? "Calculating…" : "Submit"}</Button>
        </form>
        <form action={sellOrder} className="grid gap-4 md:grid-cols-[1fr_auto]">
          <input type="hidden" name="segment" value={segmentChoice} />
          <Field label="Or upload the quote PDF" hint="Text is extracted in the app. The file is not stored.">
            <Input name="quotePdf" type="file" accept="application/pdf,.pdf" />
          </Field>
          <div className="md:pt-7">
            <Button type="submit" variant="secondary" disabled={selling}>{selling ? "Calculating…" : "Read PDF"}</Button>
          </div>
        </form>
        {selling ? (
          <div role="status" className="rounded-3xl border border-line bg-card px-6 py-8">
            <p className="font-display text-3xl">Calculating…</p>
            <p className="mt-2 text-sm text-grey">Fetching the order and pricing the install.</p>
          </div>
        ) : null}
        {sold && !selling ? <Banner tone={sold.ok ? "success" : "error"}>{sold.message}</Banner> : null}
        {summary && quote?.notice ? <blockquote className="rounded-3xl border border-red bg-card px-5 py-4 text-sm leading-6 text-ink">{quote.notice}</blockquote> : null}
        {summary ? (
          <div className="rounded-3xl border border-line bg-card px-6 py-6">
            <dl className="space-y-3 text-ink">
              <div>
                <dt className="text-sm text-grey">Install cost</dt>
                <dd className="font-display text-4xl">{money(summary.cost)}</dd>
              </div>
              <div>
                <dt className="text-sm text-grey">Recommended price</dt>
                <dd className="font-display text-4xl">{money(summary.price)}</dd>
              </div>
              <div>
                <dt className="text-sm text-grey">Margin</dt>
                <dd className="text-2xl font-semibold">{summary.margin == null ? "—" : `${Math.round(summary.margin * 1000) / 10}%`}</dd>
              </div>
            </dl>
            {salesDraft ? (
              <form action={createJob} className="mt-6">
                <DraftFields draft={salesDraft} />
                <Button type="submit" disabled={creating}>{creating ? "Creating…" : "Create job"}</Button>
              </form>
            ) : null}
          </div>
        ) : null}
        {bookingJob ? <BookingModal jobId={bookingJob} onClose={() => setBookingJob(null)} /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {previewToggle}
      <form action={loadQuote} className="grid gap-4 md:grid-cols-[1fr_auto]">
        <Field
          label="Cin7 order number"
          hint={cin7Connected ? "Looks up the sales order, for example SO-00490." : "Fixture numbers such as FIXTURE-Q-1001. Cin7 not connected."}
        >
          <Input name="quoteNumber" placeholder={cin7Connected ? "SO-00490" : "FIXTURE-Q-1001"} />
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
          <input type="hidden" name="customerId" value={draft.customerId} />
          <input type="hidden" name="saleId" value={draft.saleId} />
          <input type="hidden" name="internalNote" value={draft.internalNote} />
          <input type="hidden" name="goodsNet" value={draft.goodsNet ?? ""} />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Customer">
              <Input name="customerName" value={draft.customerName} onChange={(event) => setDraft({ ...draft, customerName: event.target.value })} required />
            </Field>
            <Field label="Site postcode">
              <Input name="postcode" value={draft.postcode} onChange={(event) => setDraft({ ...draft, postcode: event.target.value })} required autoCapitalize="characters" />
            </Field>
            <Field label="Segment" hint="Cin7 has no segment. This choice is remembered for the customer. HubSpot segment is still to come.">
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
                  <th className="px-3 py-2">Cin7 category</th>
                  <th className="px-3 py-2">Line total</th>
                </tr>
              </thead>
              <tbody>
                {draft.lines.map((line, index) => (
                  <tr key={`${line.sku}-${index}`} className="border-t border-line">
                    <td className="px-3 py-2">
                      <input type="hidden" name="lineSku" value={line.sku} />
                      <input type="hidden" name="lineProductId" value={line.productId} />
                      <input type="hidden" name="lineWeight" value={line.unitWeightKg ?? ""} />
                      <input type="hidden" name="lineUom" value={line.uom ?? ""} />
                      <input type="hidden" name="lineTileLength" value={line.tileLength ?? ""} />
                      <input type="hidden" name="lineTileWidth" value={line.tileWidth ?? ""} />
                      <input type="hidden" name="lineDimensionUnit" value={line.dimensionUnit ?? ""} />
                      <input type="hidden" name="lineTilesPerPack" value={line.tilesPerPack ?? ""} />
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
                    <td className="px-3 py-2 text-ink">
                      <input type="hidden" name="lineCategory" value={line.category} />
                      {line.category || "—"}
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
          {showInternal && draft.internalNote ? <p className="text-sm text-grey">{draft.internalNote}</p> : null}
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
          flags={quote.flags ?? []}
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

function money(value: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

function DraftFields({ draft }: { draft: QuoteDraft }) {
  return (
    <>
      <input type="hidden" name="source" value={draft.source} />
      <input type="hidden" name="quoteNumber" value={draft.quoteNumber} />
      <input type="hidden" name="customerReference" value={draft.customerReference} />
      <input type="hidden" name="customerId" value={draft.customerId} />
      <input type="hidden" name="saleId" value={draft.saleId} />
      <input type="hidden" name="internalNote" value={draft.internalNote} />
      <input type="hidden" name="goodsNet" value={draft.goodsNet ?? ""} />
      <input type="hidden" name="customerName" value={draft.customerName} />
      <input type="hidden" name="postcode" value={draft.postcode} />
      <input type="hidden" name="segment" value={draft.segment} />
      {draft.lines.map((line, index) => (
        <span key={`${line.sku}-${index}`}>
          <input type="hidden" name="lineSku" value={line.sku} />
          <input type="hidden" name="lineProductId" value={line.productId} />
          <input type="hidden" name="lineWeight" value={line.unitWeightKg ?? ""} />
          <input type="hidden" name="lineUom" value={line.uom ?? ""} />
          <input type="hidden" name="lineTileLength" value={line.tileLength ?? ""} />
          <input type="hidden" name="lineTileWidth" value={line.tileWidth ?? ""} />
          <input type="hidden" name="lineDimensionUnit" value={line.dimensionUnit ?? ""} />
          <input type="hidden" name="lineTilesPerPack" value={line.tilesPerPack ?? ""} />
          <input type="hidden" name="lineDescription" value={line.description} />
          <input type="hidden" name="lineQty" value={line.qty} />
          <input type="hidden" name="lineCategory" value={line.category} />
          <input type="hidden" name="lineTotal" value={line.lineTotal ?? ""} />
        </span>
      ))}
    </>
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
