"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { deleteServiceVisit, lookupServiceOrder, saveServiceVisit } from "@/features/service/actions";
import type { ServicePerson, ServiceVisit } from "@/features/service/queries";
import { Button, Field, Input, TextArea } from "@/components/pulse/ui";
import { Select } from "@/components/pulse/select-field";
import { VISIT_TYPES, type VisitAsset, type VisitDraft, type VisitLine } from "@/lib/service/model";

const emptyLine = (kind: VisitLine["kind"]): VisitLine => ({ kind, sku: "", serial: "", fault: "", parts: "", description: "" });

export function VisitForm({
  visit,
  people,
  canEdit,
  preset,
}: {
  visit: ServiceVisit | null;
  people: ServicePerson[];
  canEdit: boolean;
  preset?: { day?: string; personId?: string };
}) {
  const router = useRouter();
  const [customerName, setCustomerName] = useState(visit?.customerName ?? "");
  const [addressLine1, setAddressLine1] = useState(visit?.addressLine1 ?? "");
  const [addressLine2, setAddressLine2] = useState(visit?.addressLine2 ?? "");
  const [city, setCity] = useState(visit?.city ?? "");
  const [postcode, setPostcode] = useState(visit?.postcode ?? "");
  const [contactName, setContactName] = useState(visit?.contactName ?? "");
  const [contactPhone, setContactPhone] = useState(visit?.contactPhone ?? "");
  const [contactEmail, setContactEmail] = useState(visit?.contactEmail ?? "");
  const [visitType, setVisitType] = useState(visit?.visitType ?? "repair");
  const [notes, setNotes] = useState(visit?.notes ?? "");
  const [cin7OrderNumber, setCin7OrderNumber] = useState(visit?.cin7OrderNumber ?? "");
  const [hubspotTicket, setHubspotTicket] = useState(visit?.hubspotTicket ?? "");
  const [visitOn, setVisitOn] = useState(visit?.visitOn || preset?.day || "");
  const [windowStart, setWindowStart] = useState(visit?.windowStart ?? "");
  const [windowEnd, setWindowEnd] = useState(visit?.windowEnd ?? "");
  const [durationMinutes, setDurationMinutes] = useState(String(visit?.durationMinutes ?? 60));
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    visit?.assignees.map((person) => person.id) ?? (preset?.personId ? [preset.personId] : []),
  );
  const [lines, setLines] = useState<VisitLine[]>(visit?.lines.length ? visit.lines : [emptyLine("work")]);
  const [assets, setAssets] = useState<VisitAsset[]>(visit?.assets.length ? visit.assets : [{ make: "", model: "", serial: "" }]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlap, setOverlap] = useState<string | null>(null);

  function draft(): VisitDraft {
    return {
      customerName, addressLine1, addressLine2, city, postcode, contactName, contactPhone, contactEmail,
      visitType, notes, cin7OrderNumber, hubspotTicket, visitOn, windowStart, windowEnd, durationMinutes,
      assigneeIds, lines, assets,
    };
  }

  async function lookup() {
    setPending(true);
    setError(null);
    const result = await lookupServiceOrder(cin7OrderNumber);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const prefill = result.prefill;
    if (prefill.customerName) setCustomerName(prefill.customerName);
    if (prefill.addressLine1) setAddressLine1(prefill.addressLine1);
    setAddressLine2(prefill.addressLine2);
    setCity(prefill.city);
    if (prefill.postcode) setPostcode(prefill.postcode);
    if (prefill.contactName) setContactName(prefill.contactName);
    if (prefill.contactPhone) setContactPhone(prefill.contactPhone);
    if (prefill.contactEmail) setContactEmail(prefill.contactEmail);
  }

  async function save(confirmOverlap = false) {
    setPending(true);
    setError(null);
    if (!confirmOverlap) setOverlap(null);
    const result = await saveServiceVisit(visit?.id ?? null, draft(), confirmOverlap);
    setPending(false);
    if (!result.ok) {
      if (result.overlap) setOverlap(result.message);
      else setError(result.message);
      return;
    }
    setOverlap(null);
    toast.success(result.message);
    router.push(`/service/visits/${result.id}`);
    router.refresh();
  }

  async function remove() {
    if (!visit) return;
    setPending(true);
    const result = await deleteServiceVisit(visit.id);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.push("/service");
    router.refresh();
  }

  function patchLine(index: number, patch: Partial<VisitLine>) {
    setLines((current) => current.map((line, item) => (item === index ? { ...line, ...patch } : line)));
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {error ? <p className="text-sm font-semibold text-red">{error}</p> : null}
      {overlap ? (
        <div className="rounded-2xl border border-line bg-card p-4">
          <p className="font-semibold">{overlap}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" disabled={pending} onClick={() => void save(true)}>Keep this time</Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setOverlap(null)}>Cancel</Button>
          </div>
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Customer">
          <Input value={customerName} onChange={(event) => setCustomerName(event.target.value)} required disabled={!canEdit} />
        </Field>
        <Field label="Visit type">
          <Select value={visitType} onChange={(event) => setVisitType(event.target.value)} disabled={!canEdit}>
            {VISIT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </Field>
        <Field label="Address">
          <Input value={addressLine1} onChange={(event) => setAddressLine1(event.target.value)} required disabled={!canEdit} />
        </Field>
        <Field label="Address line 2">
          <Input value={addressLine2} onChange={(event) => setAddressLine2(event.target.value)} disabled={!canEdit} />
        </Field>
        <Field label="City">
          <Input value={city} onChange={(event) => setCity(event.target.value)} disabled={!canEdit} />
        </Field>
        <Field label="Postcode">
          <Input value={postcode} onChange={(event) => setPostcode(event.target.value)} required disabled={!canEdit} />
        </Field>
        <Field label="Contact">
          <Input value={contactName} onChange={(event) => setContactName(event.target.value)} disabled={!canEdit} />
        </Field>
        <Field label="Phone">
          <Input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} inputMode="tel" disabled={!canEdit} />
        </Field>
        <Field label="Email">
          <Input value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} inputMode="email" disabled={!canEdit} />
        </Field>
        <Field label="Date">
          <Input type="date" value={visitOn} onChange={(event) => { setOverlap(null); setVisitOn(event.target.value); }} required disabled={!canEdit} />
        </Field>
        <Field label="Duration (minutes)">
          <Input type="number" min={15} max={480} step={15} value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} required disabled={!canEdit} />
        </Field>
        <Field label="Window start">
          <Input type="time" value={windowStart} onChange={(event) => { setOverlap(null); setWindowStart(event.target.value); }} disabled={!canEdit} />
        </Field>
        <Field label="Window end">
          <Input type="time" value={windowEnd} onChange={(event) => { setOverlap(null); setWindowEnd(event.target.value); }} disabled={!canEdit} />
        </Field>
        <Field label="Cin7 order">
          <div className="flex gap-2">
            <Input value={cin7OrderNumber} onChange={(event) => setCin7OrderNumber(event.target.value)} disabled={!canEdit} />
            {canEdit ? <Button type="button" variant="secondary" disabled={pending} onClick={() => void lookup()}>Look up</Button> : null}
          </div>
        </Field>
        <Field label="HubSpot ticket">
          <Input value={hubspotTicket} onChange={(event) => setHubspotTicket(event.target.value)} disabled={!canEdit} />
        </Field>
      </div>
      <Field label="Notes">
        <TextArea value={notes} onChange={(event) => setNotes(event.target.value)} disabled={!canEdit} />
      </Field>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">People</legend>
        <ul className="grid gap-2 sm:grid-cols-2">
          {people.map((person) => (
            <li key={person.id}>
              <label className="flex min-h-11 items-center gap-2 rounded-2xl border border-line px-3">
                <input
                  type="checkbox"
                  checked={assigneeIds.includes(person.id)}
                  disabled={!canEdit}
                  onChange={(event) => {
                    setOverlap(null);
                    setAssigneeIds((current) => event.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id));
                  }}
                />
                <span>{person.name}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <LineGroup title="What's required" lines={lines} kind="work" canEdit={canEdit} onChange={patchLine} onAdd={() => setLines((current) => [...current, emptyLine("work")])} onRemove={(index) => setLines((current) => current.filter((_, item) => item !== index))} />
      {visitType === "swap" ? (
        <>
          <LineGroup title="Kit going out" lines={lines} kind="swap_out" canEdit={canEdit} onChange={patchLine} onAdd={() => setLines((current) => [...current, emptyLine("swap_out")])} onRemove={(index) => setLines((current) => current.filter((_, item) => item !== index))} />
          <LineGroup title="Kit coming back" lines={lines} kind="swap_back" canEdit={canEdit} onChange={patchLine} onAdd={() => setLines((current) => [...current, emptyLine("swap_back")])} onRemove={(index) => setLines((current) => current.filter((_, item) => item !== index))} />
        </>
      ) : null}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Equipment</h2>
        {assets.map((asset, index) => (
          <div key={index} className="grid gap-2 rounded-2xl border border-line p-3 md:grid-cols-3">
            <Field label="Make"><Input value={asset.make} disabled={!canEdit} onChange={(event) => setAssets((current) => current.map((item, at) => at === index ? { ...item, make: event.target.value } : item))} /></Field>
            <Field label="Model"><Input value={asset.model} disabled={!canEdit} onChange={(event) => setAssets((current) => current.map((item, at) => at === index ? { ...item, model: event.target.value } : item))} /></Field>
            <Field label="Serial"><Input value={asset.serial} disabled={!canEdit} onChange={(event) => setAssets((current) => current.map((item, at) => at === index ? { ...item, serial: event.target.value } : item))} /></Field>
          </div>
        ))}
        {canEdit ? <Button type="button" variant="secondary" onClick={() => setAssets((current) => [...current, { make: "", model: "", serial: "" }])}>Add equipment</Button> : null}
      </section>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>{pending ? "Saving" : "Save"}</Button>
          {visit ? <Button type="button" variant="danger" disabled={pending} onClick={() => void remove()}>Delete</Button> : null}
        </div>
      ) : null}
    </form>
  );
}

function LineGroup({
  title,
  lines,
  kind,
  canEdit,
  onChange,
  onAdd,
  onRemove,
}: {
  title: string;
  lines: VisitLine[];
  kind: VisitLine["kind"];
  canEdit: boolean;
  onChange: (index: number, patch: Partial<VisitLine>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const shown = lines.map((line, index) => ({ line, index })).filter((item) => item.line.kind === kind);
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {shown.length === 0 ? <p className="text-sm text-grey">None</p> : null}
      {shown.map(({ line, index }) => (
        <div key={index} className="grid gap-2 rounded-2xl border border-line p-3 md:grid-cols-2">
          <Field label="SKU"><Input value={line.sku} disabled={!canEdit} onChange={(event) => onChange(index, { sku: event.target.value })} /></Field>
          <Field label="Serial"><Input value={line.serial} disabled={!canEdit} onChange={(event) => onChange(index, { serial: event.target.value })} /></Field>
          <Field label="Fault"><Input value={line.fault} disabled={!canEdit} onChange={(event) => onChange(index, { fault: event.target.value })} /></Field>
          <Field label="Parts"><Input value={line.parts} disabled={!canEdit} onChange={(event) => onChange(index, { parts: event.target.value })} /></Field>
          {canEdit ? <Button type="button" variant="ghost" onClick={() => onRemove(index)}>Remove</Button> : null}
        </div>
      ))}
      {canEdit ? <Button type="button" variant="secondary" onClick={onAdd}>Add line</Button> : null}
    </section>
  );
}
