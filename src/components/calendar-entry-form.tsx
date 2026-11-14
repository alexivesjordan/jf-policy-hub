"use client";

import { useActionState } from "react";
import { Banner, Button, Input, TextArea } from "@/components/pulse/ui";
import { deleteCalendarEntry, saveCalendarEntry } from "@/features/people/calendar-actions";
import { CALENDAR_TYPES, calendarTypeLabel, type CalendarType } from "@/lib/company-calendar";

export function CalendarEntryForm({
  people,
  entry,
}: {
  people: { id: string; full_name: string | null; email: string }[];
  entry?: { id: string; entry_type: CalendarType; profile_id: string | null; starts_on: string; ends_on: string; notes: string | null } | null;
}) {
  const [state, action, pending] = useActionState(saveCalendarEntry, null);
  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      {entry ? <input type="hidden" name="id" value={entry.id} /> : null}
      <label className="space-y-1 text-sm font-semibold">
        Type
        <select name="entryType" defaultValue={entry?.entry_type ?? "annual_leave"} aria-label="Type" className="h-11 w-full rounded-2xl border border-line bg-field px-3">
          {CALENDAR_TYPES.map((type) => (
            <option key={type} value={type}>{calendarTypeLabel(type)}</option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm font-semibold">
        Person
        <select name="profileId" defaultValue={entry?.profile_id ?? ""} aria-label="Person" className="h-11 w-full rounded-2xl border border-line bg-field px-3">
          <option value="">Company</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>{person.full_name || person.email}</option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm font-semibold">
        Start
        <Input name="startsOn" type="date" required defaultValue={entry?.starts_on?.slice(0, 10) ?? ""} />
      </label>
      <label className="space-y-1 text-sm font-semibold">
        End
        <Input name="endsOn" type="date" required defaultValue={entry?.ends_on?.slice(0, 10) ?? ""} />
      </label>
      <label className="space-y-1 text-sm font-semibold md:col-span-2">
        Notes
        <TextArea name="notes" defaultValue={entry?.notes ?? ""} className="min-h-20" />
      </label>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : entry ? "Save" : "Add"}</Button>
        {entry ? (
          <button type="submit" formAction={deleteCalendarEntry} className="text-sm font-semibold underline">
            Remove
          </button>
        ) : null}
        {state ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
      </div>
    </form>
  );
}
