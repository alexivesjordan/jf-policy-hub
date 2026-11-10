"use client";

import { useActionState } from "react";
import { Banner, Button, Field, Input, Select, TextArea } from "@/components/ui";
import {
  createGateOverride,
  createPulseTask,
  saveCategoryEffort,
  savePricing,
  saveTerms,
} from "@/features/operations/actions";
import type { JobSummary, TermsLine } from "@/features/operations/types";

function percentInput(value: number) {
  const percent = Math.round(value * 10000) / 100;
  return String(percent);
}

export function CategoryEffortForm({
  rows,
}: {
  rows: { category: string; build_crew: number; build_minutes: number; note: string }[];
}) {
  const [state, action, pending] = useActionState(saveCategoryEffort, null);
  return (
    <form action={action} className="space-y-3">
      {rows.map((row) => (
        <div key={row.category} className="grid gap-2 md:grid-cols-[1fr_6rem_8rem]">
          <input type="hidden" name="category" value={row.category} />
          <input type="hidden" name="note" value={row.note} />
          <p className="self-center text-sm font-semibold text-ink">{row.category}</p>
          <Input name="buildCrew" type="number" min={1} max={6} defaultValue={row.build_crew} aria-label={`${row.category} crew`} />
          <Input name="buildMinutes" type="number" min={0} max={480} defaultValue={row.build_minutes} aria-label={`${row.category} minutes`} />
        </div>
      ))}
      <Field label="Reason">
        <Input name="reason" required placeholder="Why this build assumption changed" />
      </Field>
      {state ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving..." : "Save effort defaults"}</Button>
    </form>
  );
}

export function PricingForm({
  markups,
  minJobCharge,
  marginFloor,
  depositFraction,
  largeOrderThreshold,
  roundingHours,
  version,
}: {
  markups: { independent: number; franchisee: number; trade: number; corporate: number };
  minJobCharge: number | null;
  marginFloor: number | null;
  depositFraction: number;
  largeOrderThreshold: number;
  roundingHours: number;
  version: number;
}) {
  const [state, action, pending] = useActionState(savePricing, null);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <p className="text-sm text-grey md:col-span-2">
        Current version {version}. Saving adds the next version and leaves this one in place.
      </p>
      <Field label="Independent gym markup %" hint="Seeded at 40%">
        <Input name="markupIndependent" inputMode="decimal" required defaultValue={percentInput(markups.independent)} />
      </Field>
      <Field label="AF franchisee markup %" hint="Seeded at 40%">
        <Input name="markupFranchisee" inputMode="decimal" required defaultValue={percentInput(markups.franchisee)} />
      </Field>
      <Field label="Trade markup %" hint="Seeded at 50%">
        <Input name="markupTrade" inputMode="decimal" required defaultValue={percentInput(markups.trade)} />
      </Field>
      <Field label="Big corporate markup %" hint="Seeded at 80%">
        <Input name="markupCorporate" inputMode="decimal" required defaultValue={percentInput(markups.corporate)} />
      </Field>
      <Field label="Minimum job charge £" hint={minJobCharge == null ? "Not configured" : undefined}>
        <Input name="minJobCharge" inputMode="decimal" placeholder="Not configured" defaultValue={minJobCharge ?? ""} />
      </Field>
      <Field label="Margin floor %" hint={marginFloor == null ? "Not configured" : undefined}>
        <Input
          name="marginFloor"
          inputMode="decimal"
          placeholder="Not configured"
          defaultValue={marginFloor == null ? "" : percentInput(marginFloor)}
        />
      </Field>
      <Field label="Custom-item deposit %" hint="Seeded at one third">
        <Input name="depositPercent" inputMode="decimal" required defaultValue={percentInput(depositFraction)} />
      </Field>
      <Field label="Large-order threshold £" hint="Seeded at 50000">
        <Input name="largeOrder" inputMode="decimal" required defaultValue={String(largeOrderThreshold)} />
      </Field>
      <Field label="Variation rounding (hours)" hint="Seeded at 0.5">
        <Input name="roundingHours" inputMode="decimal" required defaultValue={String(roundingHours)} />
      </Field>
      <Field label="Reason for this version">
        <Input name="reason" required maxLength={500} placeholder="Why this version" />
      </Field>
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save new pricing version"}
        </Button>
      </div>
      {state ? (
        <div className="md:col-span-2">
          <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner>
        </div>
      ) : null}
    </form>
  );
}

export function TermsForm({ lines }: { lines: TermsLine[] }) {
  const [state, action, pending] = useActionState(saveTerms, null);
  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-grey">
        Rates are ex VAT. Saving stores a new version. It is not marked live until the terms review is finished.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr className="text-left text-grey">
              <th className="border-b border-line py-2 pr-3 font-semibold">Line</th>
              <th className="border-b border-line py-2 pr-3 font-semibold">Rate £</th>
              <th className="border-b border-line py-2 font-semibold">Mileage £</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.label} className="align-top">
                <td className="border-b border-line py-3 pr-3">
                  <input type="hidden" name="label" value={line.label} />
                  <p className="font-semibold text-ink">{line.label}</p>
                  <p className="mt-1 text-grey">{line.unit || basisLabel(line.basis) || "Seeded line"}</p>
                </td>
                <td className="border-b border-line py-3 pr-3">
                  <Input name="rate" inputMode="decimal" defaultValue={line.rate ?? ""} aria-label={`Rate for ${line.label}`} />
                </td>
                <td className="border-b border-line py-3">
                  <Input
                    name="mileage"
                    inputMode="decimal"
                    defaultValue={line.mileage ?? ""}
                    aria-label={`Mileage for ${line.label}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Field label="Reason for this version">
        <Input name="reason" required maxLength={500} placeholder="Why this version" />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save new charges version"}
      </Button>
      {state ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
    </form>
  );
}

function basisLabel(basis: string | null | undefined) {
  if (basis === "cost_plus_25") return "Cost + 25%";
  if (basis === "at_cost") return "At cost";
  if (basis === "additional_installer_time") return "Charged as additional installer time";
  return basis ?? "";
}

const GATES = [
  ["access_form", "Access form"],
  ["payment", "Payment"],
  ["big_install_media", "Big-install media"],
  ["variation", "Variation"],
  ["booking", "Booking"],
] as const;

export function GateOverrideForm({ jobs }: { jobs: JobSummary[] }) {
  const [state, action, pending] = useActionState(createGateOverride, null);
  return (
    <form action={action} className="grid gap-4">
      <Field label="Job">
        <Select name="jobId" required defaultValue={jobs[0]?.id ?? ""}>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.cin7_number ?? job.id.slice(0, 8)} — {job.customer_name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Gate">
        <Select name="gate" required defaultValue="payment">
          {GATES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Reason" hint="Required. This cannot be edited later.">
        <TextArea name="reason" required maxLength={2000} />
      </Field>
      <Button type="submit" disabled={pending || jobs.length === 0}>
        {pending ? "Saving..." : "Record override"}
      </Button>
      {state ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
    </form>
  );
}

export function TaskForm() {
  const [state, action, pending] = useActionState(createPulseTask, null);
  return (
    <form action={action} className="grid gap-4">
      <Field label="Title">
        <Input name="title" required maxLength={200} placeholder="Blocked gate, single driver, insurance..." />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Kind">
          <Select name="kind" defaultValue="exception">
            <option value="exception">Exception</option>
            <option value="fleet">Fleet</option>
            <option value="countdown">Countdown</option>
            <option value="general">General</option>
          </Select>
        </Field>
        <Field label="Priority">
          <Select name="priority" defaultValue="normal">
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </Select>
        </Field>
      </div>
      <Field label="Notes">
        <TextArea name="body" />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding..." : "Add task"}
      </Button>
      {state ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
    </form>
  );
}
