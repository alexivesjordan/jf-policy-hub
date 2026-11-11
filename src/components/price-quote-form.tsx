"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { PriceWorkings } from "@/components/price-workings";
import { QuoteNotice } from "@/components/quote-notice";
import { ServiceQuoteResult } from "@/components/service-quote-result";
import { Banner, Button, Field, Input, Select } from "@/components/pulse/ui";
import { Checkbox } from "@/components/ui/checkbox";
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
  fullBreakdown,
}: {
  cin7Connected: boolean;
  fullBreakdown: boolean;
}) {
  const [loaded, loadQuote, loading] = useActionState(loadFixtureQuote, null);
  const [parsed, parsePdf, parsing] = useActionState(parseUploadedQuote, null);
  const [priced, priceQuote, pricing] = useActionState(priceReviewedQuote, null);
  const [created, createJob, creating] = useActionState(createPricedJob, null);
  const [sold, sellOrder, selling] = useActionState(priceSalesOrder, null);
  const [draft, setDraft] = useState<QuoteDraft | null>(null);
  const [sourceName, setSourceName] = useState<"load" | "pdf" | null>(null);
  const [includeService, setIncludeService] = useState(false);
  const [pdfIntent, setPdfIntent] = useState(false);
  const pdfForm = useRef<HTMLFormElement>(null);

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

  const toastedSale = useRef<string | null>(null);
  useEffect(() => {
    if (!sold?.ok || !sold.message || toastedSale.current === sold.message) return;
    toastedSale.current = sold.message;
    toast.success(sold.message);
  }, [sold]);

  const quote = (created?.quote ?? (!fullBreakdown ? sold?.quote ?? priced?.quote : priced?.quote)) as PricedQuote | undefined;
  const notice = sourceName === "pdf" ? parsed : sourceName === "load" ? loaded : null;
  const readingPdf = pdfIntent && (parsing || selling);
  const serviceToggle = (
    <label className="flex min-h-11 items-start gap-3 text-sm font-semibold text-ink">
      <Checkbox checked={includeService} onCheckedChange={(checked) => setIncludeService(checked === true)} />
      <span>Also quote proactive maintenance and extended warranty</span>
    </label>
  );

  if (!fullBreakdown) {
    const summary = quote?.repSummary;
    return (
      <div className="space-y-6">
        <form action={sellOrder} className="grid gap-4 md:grid-cols-[1fr_auto]">
          <Field label="Order number" hint="For example SO-00490.">
            <Input name="quoteNumber" placeholder={cin7Connected ? "SO-00490" : "FIXTURE-Q-1001"} />
          </Field>
          <div className="md:pt-7">
            <Button type="submit" disabled={selling || readingPdf}>{selling && !readingPdf ? "Calculating…" : "Load quote"}</Button>
          </div>
        </form>
        <form ref={pdfForm} action={sellOrder}>
          <Field label="Or upload the quote PDF" hint="We read the quote. The file is not kept.">
            <QuoteFileDrop onReady={() => { setPdfIntent(true); pdfForm.current?.requestSubmit(); }} />
          </Field>
        </form>
        {serviceToggle}
        {readingPdf ? <ReadingQuote /> : null}
        {selling && !readingPdf ? (
          <div role="status" className="rounded-3xl border border-line bg-card px-6 py-8">
            <p className="font-display text-3xl">Calculating…</p>
            <p className="mt-2 text-sm text-grey">Fetching the order and pricing the install.</p>
          </div>
        ) : null}
        {sold && !selling && !sold.ok ? <Banner tone="error">{sold.message}</Banner> : null}
        {summary && quote?.notice ? <QuoteNotice>{quote.notice}</QuoteNotice> : null}
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
          </div>
        ) : null}
        {includeService && summary ? <ServiceQuoteResult installPrice={summary.price} /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form action={loadQuote} className="grid gap-4 md:grid-cols-[1fr_auto]">
        <Field label="Order number" hint="For example SO-00490.">
          <Input name="quoteNumber" placeholder={cin7Connected ? "SO-00490" : "FIXTURE-Q-1001"} />
        </Field>
        <div className="md:pt-7">
          <Button type="submit" disabled={loading}>{loading ? "Loading..." : "Load quote"}</Button>
        </div>
      </form>
      <form ref={pdfForm} action={parsePdf}>
        <Field label="Or upload the quote PDF" hint="We read the quote. The file is not kept.">
          <QuoteFileDrop onReady={() => { setPdfIntent(true); pdfForm.current?.requestSubmit(); }} />
        </Field>
      </form>
      {serviceToggle}
      {readingPdf ? <ReadingQuote /> : null}

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
            <Field label="Segment" hint="We remember this for the customer next time.">
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
          {draft.internalNote ? <p className="text-sm text-grey">{draft.internalNote}</p> : null}
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
      ) : quote?.notice ? <QuoteNotice>{quote.notice}</QuoteNotice> : null}
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
      {includeService && quote?.customerPrice != null ? <ServiceQuoteResult installPrice={quote.customerPrice} /> : null}
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

function ReadingQuote() {
  return (
    <div role="status" className="rounded-3xl border border-line bg-card px-6 py-8">
      <p className="font-display text-3xl">Reading quote…</p>
      <p className="mt-2 text-sm text-grey">Reading the PDF. The file is not kept.</p>
    </div>
  );
}

function QuoteFileDrop({ onReady }: { onReady: () => void }) {
  const [fileName, setFileName] = useState("");

  function assign(input: HTMLInputElement, file: File | null) {
    const transfer = new DataTransfer();
    if (file) transfer.items.add(file);
    input.files = transfer.files;
    setFileName(file?.name ?? "");
    if (file) onReady();
  }

  return (
    <div
      className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-field px-4 py-6 text-center"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const input = event.currentTarget.querySelector("input");
        if (input) assign(input, event.dataTransfer.files?.[0] ?? null);
      }}
    >
      <Upload className="mb-2 size-5 text-muted-foreground" aria-hidden="true" />
      <span className="text-sm font-semibold">{fileName || "Drop a PDF here, or choose a file"}</span>
      <input
        name="quotePdf"
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          setFileName(file?.name ?? "");
          if (file) onReady();
        }}
      />
    </div>
  );
}

function money(value: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
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
