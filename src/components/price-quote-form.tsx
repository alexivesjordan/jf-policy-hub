"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { QuoteLineFields } from "@/components/quote-line-fields";
import { ProposalButton, ServiceQuoteResult } from "@/components/service-quote-result";
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
          <input type="hidden" name="alsoService" value={includeService ? "yes" : ""} />
          <div className="md:pt-7">
            <Button type="submit" disabled={selling || readingPdf}>{selling && !readingPdf ? "Calculating…" : "Load quote"}</Button>
          </div>
        </form>
        <form ref={pdfForm} action={sellOrder}>
          <input type="hidden" name="alsoService" value={includeService ? "yes" : ""} />
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
        {summary ? <InstallPriceCard price={summary.price} quoteNumber={quote?.quoteNumber} postcode={quote?.postcode} /> : null}
        {includeService && quote?.service ? (
          <>
            <ServiceQuoteResult service={quote.service} />
            <ProposalButton quoteId={quote.service.id} />
          </>
        ) : null}
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
          <input type="hidden" name="alsoService" value={includeService ? "yes" : ""} />
          <input type="hidden" name="source" value={draft.source} />
          <input type="hidden" name="quoteNumber" value={draft.quoteNumber} />
          <input type="hidden" name="customerReference" value={draft.customerReference} />
          <input type="hidden" name="customerId" value={draft.customerId} />
          <input type="hidden" name="saleId" value={draft.saleId} />
          <input type="hidden" name="internalNote" value={draft.internalNote} />
          <input type="hidden" name="goodsNet" value={draft.goodsNet ?? ""} />
          <input
            type="hidden"
            name="serviceReconcile"
            value={JSON.stringify({
              goodsNet: draft.goodsNet,
              orderNet: draft.orderNet,
              deliveryInstallLines: draft.deliveryInstall,
              flags: draft.moneyFlags,
            })}
          />
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
          <QuoteLineFields lines={draft.lines} />
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
      {quote?.customerPrice != null ? <InstallPriceCard price={quote.customerPrice} quoteNumber={quote.quoteNumber} postcode={quote.postcode} /> : null}
      {includeService && quote?.service ? (
        <>
          <ServiceQuoteResult service={quote.service} />
          <ProposalButton quoteId={quote.service.id} />
        </>
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

function InstallPriceCard({ price, quoteNumber, postcode }: { price: number; quoteNumber?: string; postcode?: string }) {
  return (
    <div className="rounded-3xl border border-line bg-card px-6 py-6">
      {quoteNumber || postcode ? <p className="text-sm text-grey">{[quoteNumber, postcode].filter(Boolean).join(" · ")}</p> : null}
      <p className="mt-2 text-sm text-grey">Install price</p>
      <p className="font-display text-4xl">{money(price)}</p>
      <p className="mt-2 text-sm text-grey">ex VAT</p>
    </div>
  );
}

