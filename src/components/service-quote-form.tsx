"use client";

import { useActionState, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { LockedFields } from "@/components/locked-fields";
import { ProposalButton, ServiceQuoteResult } from "@/components/service-quote-result";
import { Banner, Button, Field, Input, Select } from "@/components/pulse/ui";
import { priceServiceQuote, saveClassificationRule, saveServiceRates } from "@/features/sales/service-actions";
import { SERVICE_CATEGORIES, type ServiceRates } from "@/lib/service-quote/rates";

const CATEGORY_LABELS: Record<string, string> = {
  jordan_cardio: "Jordan cardio",
  jordan_cardio_unverified: "Jordan cardio, unverified",
  concept2_cardio: "Concept2 cardio",
  other_cardio_unverified: "Other cardio, unverified",
  strength_machine: "Strength machine",
  cable_or_power_rack: "Cable or power rack",
  adjustable_bench: "Adjustable bench",
  unresolved_dhz: "Unresolved DHZ",
  storage_rack: "Storage rack",
  loose_accessory: "Loose accessory",
  flooring: "Flooring",
  delivery_install: "Delivery and install",
  unknown_product: "Unknown product",
};

export function ServiceQuoteForm({ cin7Connected }: { cin7Connected: boolean }) {
  const [priced, price, pricing] = useActionState(priceServiceQuote, null);
  const [pdfIntent, setPdfIntent] = useState(false);
  const pdfForm = useRef<HTMLFormElement>(null);
  const reading = pdfIntent && pricing;
  const service = priced?.service;

  return (
    <div className="space-y-6">
      <form action={price} className="grid gap-4 md:grid-cols-[1fr_auto]">
        <Field label="Order number" hint="For example SO-00490.">
          <Input name="quoteNumber" placeholder={cin7Connected ? "SO-00490" : "EXAMPLE-00490"} />
        </Field>
        <div className="md:pt-7">
          <Button type="submit" disabled={pricing && !reading} onClick={() => setPdfIntent(false)}>{pricing && !reading ? "Calculating…" : "Load quote"}</Button>
        </div>
      </form>
      <form ref={pdfForm} action={price}>
        <Field label="Or upload the quote PDF" hint="We read the quote. The file is not kept.">
          <DropPdf onReady={() => { setPdfIntent(true); pdfForm.current?.requestSubmit(); }} />
        </Field>
      </form>
      {reading ? (
        <div role="status" className="rounded-3xl border border-line bg-card px-6 py-8">
          <p className="font-display text-3xl">Reading quote…</p>
          <p className="mt-2 text-sm text-grey">Reading the PDF, then pricing maintenance and warranty.</p>
        </div>
      ) : null}
      {pricing && !reading ? (
        <div role="status" className="rounded-3xl border border-line bg-card px-6 py-8">
          <p className="font-display text-3xl">Calculating…</p>
          <p className="mt-2 text-sm text-grey">Pricing proactive maintenance and the five-year parts warranty.</p>
        </div>
      ) : null}
      {priced && !pricing && !priced.ok ? <Banner tone="error">{priced.message}</Banner> : null}
      {service ? <ServiceQuoteResult service={service} /> : null}
      {service ? <ProposalButton quoteId={service.id} /> : null}
    </div>
  );
}

function DropPdf({ onReady }: { onReady: () => void }) {
  const [fileName, setFileName] = useState("");
  return (
    <div
      className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-field px-4 py-6 text-center"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const input = event.currentTarget.querySelector("input");
        const file = event.dataTransfer.files?.[0] ?? null;
        if (!input || !file) return;
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        setFileName(file.name);
        onReady();
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

function roundPercent(value: number) {
  return Math.round(value * 10) / 10;
}

function MoneyRate({ name, label, pounds, disabled }: { name: string; label: string; pounds: number; disabled: boolean }) {
  return (
    <label className="text-sm font-semibold">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <span className="text-muted-foreground">£</span>
        <Input name={name} type="number" min="0" step="1" defaultValue={pounds} disabled={disabled} />
      </span>
      <span className="mt-1 block text-xs font-normal text-grey">Saved as £{pounds.toFixed(2)}</span>
    </label>
  );
}

function PercentRate({
  name,
  label,
  stored,
  kind,
  disabled,
}: {
  name: string;
  label: string;
  stored: number;
  kind: "extra" | "discount" | "share";
  disabled: boolean;
}) {
  const initial = kind === "extra" ? (stored - 1) * 100 : kind === "discount" ? (1 - stored) * 100 : stored * 100;
  const [percent, setPercent] = useState(roundPercent(initial));
  const saved = kind === "extra" ? 1 + percent / 100 : kind === "discount" ? 1 - percent / 100 : percent / 100;
  return (
    <label className="text-sm font-semibold">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <Input type="number" min="0" step="0.1" value={percent} disabled={disabled} onChange={(event) => setPercent(Number(event.target.value))} />
        <span className="text-muted-foreground">%</span>
      </span>
      <input type="hidden" name={name} value={Number.isFinite(saved) ? saved : stored} />
    </label>
  );
}

export function ServiceRateEditor({ rates, canEdit }: { rates: ServiceRates; canEdit: boolean }) {
  const [state, action, pending] = useActionState(saveServiceRates, null);
  return (
    <LockedFields locked={!canEdit}>
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MoneyRate name="callout" label="Call-out" pounds={rates.callout} disabled={!canEdit} />
        <MoneyRate name="perMachine" label="Per machine" pounds={rates.perMachine} disabled={!canEdit} />
        <PercentRate name="uplift" label="Uplift" stored={rates.uplift} kind="extra" disabled={!canEdit} />
        <PercentRate name="twiceYearlyFactor" label="Twice-yearly discount" stored={rates.twiceYearlyFactor} kind="discount" disabled={!canEdit} />
        <PercentRate name="cardioRate" label="Cardio" stored={rates.cardioRate} kind="share" disabled={!canEdit} />
        <PercentRate name="strengthRate" label="Strength" stored={rates.strengthRate} kind="share" disabled={!canEdit} />
        <PercentRate name="rackRate" label="Rack" stored={rates.rackRate} kind="share" disabled={!canEdit} />
        <PercentRate name="extensionFactor" label="Warranty uplift" stored={rates.extensionFactor} kind="extra" disabled={!canEdit} />
        <MoneyRate name="perSite" label="Per site" pounds={rates.perSite} disabled={!canEdit} />
        <MoneyRate name="bundleIncentive" label="Bundle incentive" pounds={rates.bundleIncentive} disabled={!canEdit} />
        <PercentRate name="portfolioFactor" label="Portfolio discount" stored={rates.portfolioFactor} kind="discount" disabled={!canEdit} />
        <label className="text-sm font-semibold">
          <span className="mb-1 block text-muted-foreground">Effective on</span>
          <Input name="effectiveOn" type="date" required disabled={!canEdit} />
        </label>
        <label className="text-sm font-semibold sm:col-span-2">
          <span className="mb-1 block text-muted-foreground">Reason</span>
          <Input name="reason" disabled={!canEdit} />
        </label>
      </div>
      <Button type="submit" disabled={!canEdit || pending}>{pending ? "Saving…" : "Save rates"}</Button>
      {state ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
    </form>
    </LockedFields>
  );
}

export type ClassificationRuleRow = {
  match_kind: string;
  match_value: string;
  category: string;
  priority: number;
  note: string | null;
};

export function ClassificationEditor({ rules, canEdit }: { rules: ClassificationRuleRow[]; canEdit: boolean }) {
  const [state, action, pending] = useActionState(saveClassificationRule, null);
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-2">Match</th>
              <th className="px-3 py-2">Value</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Priority</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr><td className="px-3 py-3 text-grey" colSpan={4}>No extra rules. The built-in names still apply.</td></tr>
            ) : rules.map((rule) => (
              <tr key={`${rule.match_kind}-${rule.match_value}`} className="border-t border-border">
                <td className="px-3 py-2">{rule.match_kind === "description_contains" ? "Description contains" : rule.match_kind === "category_name" ? "Cin7 category" : "SKU"}</td>
                <td className="px-3 py-2">{rule.match_value}</td>
                <td className="px-3 py-2">{CATEGORY_LABELS[rule.category] ?? rule.category}</td>
                <td className="px-3 py-2">{rule.priority}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <LockedFields locked={!canEdit}>
        <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-semibold">
            <span className="mb-1 block text-muted-foreground">Match</span>
            <Select name="matchKind" defaultValue="description_contains" aria-label="Match" disabled={!canEdit}>
              <option value="description_contains">Description contains</option>
              <option value="category_name">Cin7 category</option>
              <option value="sku">SKU</option>
            </Select>
          </label>
          <label className="text-sm font-semibold">
            <span className="mb-1 block text-muted-foreground">Value</span>
            <Input name="matchValue" required disabled={!canEdit} />
          </label>
          <label className="text-sm font-semibold">
            <span className="mb-1 block text-muted-foreground">Category</span>
            <Select name="category" defaultValue="strength_machine" aria-label="Category" disabled={!canEdit}>
              {SERVICE_CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}
            </Select>
          </label>
          <label className="text-sm font-semibold">
            <span className="mb-1 block text-muted-foreground">Priority</span>
            <Input name="priority" type="number" defaultValue={100} disabled={!canEdit} />
          </label>
          <div className="sm:col-span-2 lg:col-span-4">
            <Button type="submit" disabled={!canEdit || pending}>{pending ? "Saving…" : "Save rule"}</Button>
          </div>
          {state ? <div className="sm:col-span-2 lg:col-span-4"><Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner></div> : null}
        </form>
      </LockedFields>
    </div>
  );
}
