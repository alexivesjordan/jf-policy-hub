"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { BookInstallDialog } from "@/components/book-install-dialog";
import { ProposalButton, ServiceQuoteResult } from "@/components/service-quote-result";
import { Banner, Button, Field, Input, Select } from "@/components/pulse/ui";
import { Checkbox } from "@/components/ui/checkbox";
import { priceSalesOrder, type PricedQuote } from "@/features/operations/price-actions";
import { quoteFailureText } from "@/lib/pulse/quote-segment";

const SEGMENTS = [
  ["independent", "Independent"],
  ["franchisee", "Franchisee"],
  ["trade", "Trade"],
  ["big_corporate", "Big corporate"],
] as const;

export function PriceQuoteForm({ cin7Connected }: { cin7Connected: boolean }) {
  const [sold, sellOrder, selling] = useActionState(priceSalesOrder, null);
  const [orderNumber, setOrderNumber] = useState("");
  const [segment, setSegment] = useState("");
  const [askSegment, setAskSegment] = useState(false);
  const [includeService, setIncludeService] = useState(false);
  const [pdfIntent, setPdfIntent] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const pdfForm = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!sold || selling) return;
    if (sold.needsSegment) setAskSegment(true);
    else if (sold.ok) setAskSegment(false);
  }, [sold, selling]);

  useEffect(() => {
    const input = pdfForm.current?.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input || !pdfFile) return;
    const transfer = new DataTransfer();
    transfer.items.add(pdfFile);
    input.files = transfer.files;
  }, [pdfFile, sold]);

  const toastedSale = useRef<string | null>(null);
  useEffect(() => {
    if (!sold?.ok || !sold.message || toastedSale.current === sold.message) return;
    toastedSale.current = sold.message;
    toast.success(sold.message);
  }, [sold]);

  const quote = sold?.quote as PricedQuote | undefined;
  const readingPdf = pdfIntent && selling;
  const failure = selling ? null : quoteFailureText(sold);
  const segmentFields = askSegment ? (
    <>
      <Field label="Segment">
        <Select name="segment" required value={segment} onChange={(event) => setSegment(event.target.value)}>
          <option value="">Choose</option>
          {SEGMENTS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
      </Field>
      {pdfFile ? <input type="hidden" name="segment" value={segment} form="quote-pdf" /> : null}
    </>
  ) : null;

  return (
    <div className="space-y-6">
      <form action={sellOrder} className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <Field label="Order number">
            <Input
              name="quoteNumber"
              value={orderNumber}
              onChange={(event) => setOrderNumber(event.target.value)}
              placeholder={cin7Connected ? "SO-00490" : "FIXTURE-Q-1001"}
            />
          </Field>
          <div className="md:pt-7">
            <Button type="submit" form={askSegment && pdfFile && !orderNumber.trim() ? "quote-pdf" : undefined} disabled={selling || (askSegment && !segment)}>
              {selling && !readingPdf ? "Calculating…" : "Load quote"}
            </Button>
          </div>
        </div>
        <input type="hidden" name="alsoService" value={includeService ? "yes" : ""} />
        {segmentFields}
      </form>
      <form id="quote-pdf" ref={pdfForm} action={sellOrder}>
        <input type="hidden" name="alsoService" value={includeService ? "yes" : ""} />
        <Field label="Or upload the quote PDF" hint="We read the quote. The file is not kept.">
          <QuoteFileDrop
            onReady={(file) => {
              setPdfFile(file);
              setPdfIntent(true);
              pdfForm.current?.requestSubmit();
            }}
          />
        </Field>
      </form>
      <label className="flex min-h-11 items-start gap-3 text-sm font-semibold text-ink">
        <Checkbox checked={includeService} onCheckedChange={(checked) => setIncludeService(checked === true)} />
        <span>Also quote proactive maintenance and extended warranty</span>
      </label>
      {readingPdf ? <ReadingQuote /> : null}
      {selling && !readingPdf ? (
        <div role="status" className="rounded-3xl border border-line bg-card px-6 py-8">
          <p className="font-display text-3xl">Calculating…</p>
        </div>
      ) : null}
      {failure ? <Banner tone="error">{failure}</Banner> : null}
      {quote?.customerPrice != null ? <InstallPriceCard price={quote.customerPrice} quoteNumber={quote.quoteNumber} postcode={quote.postcode} /> : null}
      {includeService && quote?.service ? (
        <>
          <ServiceQuoteResult service={quote.service} />
          <ProposalButton quoteId={quote.service.id} />
        </>
      ) : null}
      {quote?.savedQuoteId ? <BookInstallDialog quoteId={quote.savedQuoteId} warranty={includeService ? warrantyPrices(quote.service) : null} /> : null}
    </div>
  );
}

function ReadingQuote() {
  return (
    <div role="status" className="rounded-3xl border border-line bg-card px-6 py-8">
      <p className="font-display text-3xl">Reading quote…</p>
      <p className="mt-2 text-sm text-grey">The file is not kept.</p>
    </div>
  );
}

function QuoteFileDrop({ onReady }: { onReady: (file: File) => void }) {
  const [fileName, setFileName] = useState("");

  function assign(input: HTMLInputElement, file: File | null) {
    const transfer = new DataTransfer();
    if (file) transfer.items.add(file);
    input.files = transfer.files;
    setFileName(file?.name ?? "");
    if (file) onReady(file);
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
          if (file) onReady(file);
        }}
      />
    </div>
  );
}

function money(value: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

function warrantyPrices(service: { prices?: { prices: { annualPm: number; twiceYearlyPm: number; extendedWarrantyOneOff: number; annualBundleYear1: number | null; twiceBundleYear1: number | null } }[] } | null | undefined) {
  return service?.prices?.[0]?.prices ?? null;
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
