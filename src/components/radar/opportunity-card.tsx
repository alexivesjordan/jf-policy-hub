"use client";

import { useActionState } from "react";
import { reviewOpportunity, type RadarActionState } from "@/features/radar/actions";
import type { RadarCard, RadarOwner } from "@/features/radar/queries";
import { Banner, Button, Field, Input, Select } from "@/components/pulse/ui";

const STATUS_LABEL = {
  new: "New",
  worth_pursuing: "Worth pursuing",
  dismissed: "Dismissed",
  pushed_to_hubspot: "Pushed to HubSpot",
} as const;

export function OpportunityCard({ item, canEdit, owners, hubspotConnected }: { item: RadarCard; canEdit: boolean; owners: RadarOwner[]; hubspotConnected: boolean }) {
  const [state, action, pending] = useActionState(reviewOpportunity, null as RadarActionState);
  const pushed = item.status === "pushed_to_hubspot";
  return (
    <article className={`space-y-4 rounded-3xl border border-line bg-card p-5 ${item.highlight ? "ring-2 ring-primary" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-grey">{item.typeLabel} · {item.sourceLabel}</p>
          <h2 className="mt-1 text-lg font-semibold text-ink">{item.title}</h2>
          <p className="text-sm text-grey">{item.buyer}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-2xl font-semibold tabular-nums text-ink">{item.score}</p>
          <p className="text-xs font-semibold uppercase tracking-wide text-grey">{STATUS_LABEL[item.status]}</p>
        </div>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Value" value={item.value} />
        <Fact label="Deadline" value={item.deadline} />
        <Fact label="Award" value={item.award} />
        <Fact label="Decision" value={item.decision} />
        <Fact label="Address" value={item.address} />
        <Fact label="Postcode" value={item.postcode} />
        <Fact label="Authority" value={item.lpa} />
        <Fact label="Region" value={item.region} />
      </dl>
      {item.scope !== "Not published" ? <p className="text-sm">{item.scope}</p> : null}
      <p className="text-sm text-grey">Facilities {item.facilities}</p>
      <p className="text-sm text-grey">Contact {item.contact}</p>
      <p className="text-sm text-grey">CPV {item.cpv}</p>
      {item.reasons.length > 0 ? (
        <div>
          <p className="text-sm font-semibold">Matched</p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {item.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {item.dismissReason ? (
        <p className="text-sm">
          <span className="font-semibold">Reason </span>
          {item.dismissReason}
        </p>
      ) : null}
      {item.dealUrl ? (
        <a href={item.dealUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm font-semibold underline decoration-primary">
          HubSpot deal
        </a>
      ) : null}
      <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm font-semibold underline decoration-primary">
        Notice
      </a>
      {canEdit ? (
        <form action={action} className="space-y-3 border-t border-line pt-4">
          <input type="hidden" name="id" value={item.id} />
          {state?.message ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="Owner">
              <Select name="owner_id" defaultValue={item.ownerId}>
                <option value="">Unassigned</option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>{owner.name}</option>
                ))}
              </Select>
            </Field>
            <Button type="submit" name="intent" value="assign" variant="secondary" disabled={pending}>Assign</Button>
          </div>
          {pushed ? null : (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {item.status === "worth_pursuing" ? null : <Button type="submit" name="intent" value="pursue" variant="secondary" disabled={pending}>Worth pursuing</Button>}
              {item.status === "new" ? null : <Button type="submit" name="intent" value="reset" variant="secondary" disabled={pending}>New</Button>}
              {hubspotConnected ? (
                <Button type="submit" name="intent" value="push" disabled={pending}>Push to HubSpot</Button>
              ) : (
                <Button type="button" variant="secondary" disabled>{"HubSpot isn't connected"}</Button>
              )}
            </div>
          )}
          {pushed ? null : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field label="Reason">
                <Input name="reason" maxLength={500} />
              </Field>
              <Button type="submit" name="intent" value="dismiss" variant="danger" disabled={pending}>Dismiss</Button>
            </div>
          )}
        </form>
      ) : null}
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-grey">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
