"use client";

import { useActionState, useState } from "react";
import { Banner, Button, Field, Input, TextArea } from "@/components/pulse/ui";
import { sendSubcontractorQuote } from "@/features/subcontractors/quote-actions";
import type { QuoteChoice } from "@/lib/subcontractors/capability";
import { formatUkDate, isWeekday, replaceDateBlock } from "@/lib/subcontractors/draft";

export function SubcontractorQuote({
  offer,
}: {
  offer: {
    savedQuoteId: string;
    quoteNumber: string;
    customerName: string;
    postcode: string;
    jobTypes: string[];
    subject: string;
    draft: string;
    choices: QuoteChoice[];
  };
}) {
  const [state, action, pending] = useActionState(sendSubcontractorQuote, null);
  const [dates, setDates] = useState<string[]>([]);
  const [date, setDate] = useState("");
  const [dateNote, setDateNote] = useState("");
  const [body, setBody] = useState(offer.draft);

  function setNextDates(next: string[]) {
    setDates(next);
    setBody((current) => replaceDateBlock(current, next));
  }

  function addDate() {
    if (!isWeekday(date)) {
      setDateNote("Weekends are not bookable.");
      return;
    }
    setDateNote("");
    setNextDates(dates.includes(date) ? dates : [...dates, date].sort());
    setDate("");
  }

  return (
    <form action={action} className="space-y-5 rounded-3xl border border-line bg-card px-5 py-5">
      <input type="hidden" name="savedQuoteId" value={offer.savedQuoteId} />
      <input type="hidden" name="dates" value={dates.join(",")} />
      <div>
        <h2 className="font-display text-2xl">Subcontractor quote</h2>
        <p className="mt-1 text-sm text-grey">{offer.customerName} · {offer.postcode || "No postcode"} · {offer.jobTypes.join(", ")}</p>
      </div>
      <Field label="Suggested dates" hint="Weekdays only.">
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <Button type="button" variant="secondary" onClick={addDate}>Add date</Button>
        </div>
      </Field>
      {dateNote ? <p className="text-sm">{dateNote}</p> : null}
      {dates.length > 0 ? (
        <ul className="flex flex-wrap gap-2 text-sm">
          {dates.map((day) => (
            <li key={day}><button type="button" className="rounded-full border border-line px-3 py-1" onClick={() => setNextDates(dates.filter((item) => item !== day))}>{formatUkDate(day)} ×</button></li>
          ))}
        </ul>
      ) : null}
      <Field label="Subject"><Input name="subject" defaultValue={offer.subject} required /></Field>
      <Field label="Email"><TextArea name="body" value={body} onChange={(event) => setBody(event.target.value)} required className="min-h-64" /></Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Subcontractors</legend>
        <p className="text-sm text-grey">Capable ones are ticked. A subcontractor with no in-date insurance cannot be selected or emailed.</p>
        <ul className="space-y-2">
          {offer.choices.map((choice) => (
            <li key={choice.id} className="rounded-2xl border border-line px-3 py-3">
              <label className="flex items-start gap-3">
                <input type="checkbox" name="subcontractorId" value={choice.id} defaultChecked={choice.preselected} disabled={!choice.selectable} className="mt-1 size-5 accent-primary" />
                <span className="text-sm">
                  <span className="font-semibold">{choice.name}</span>
                  <span className="mt-1 block text-grey">{[statusLabel(choice.status), choice.regions.join(", ") || "No area limit", choice.jobTypes.join(", "), choice.maxCrew ? `up to ${choice.maxCrew}` : ""].filter(Boolean).join(" · ")}</span>
                  {choice.emails[0] ? <span className="mt-1 block">{choice.emails.join(", ")}</span> : null}
                  {!choice.insuranceInDate ? <span className="mt-1 block font-semibold">No in-date insurance</span> : null}
                  {choice.checkEmail ? <span className="mt-1 block font-semibold">Check email</span> : null}
                  {choice.reason && choice.insuranceInDate ? <span className="mt-1 block text-grey">{choice.reason}</span> : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {state ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
      <Button type="submit" disabled={pending || dates.length === 0}>{pending ? "Sending…" : "Send separate emails"}</Button>
    </form>
  );
}

function statusLabel(status: string) {
  if (status === "on_hold") return "On hold";
  if (status === "preferred") return "Preferred";
  if (status === "inactive") return "Inactive";
  return "Active";
}
