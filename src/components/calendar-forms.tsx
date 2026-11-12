"use client";

import { useActionState } from "react";
import { DateField } from "@/components/date-field";
import { Banner, Button, Field, Select } from "@/components/pulse/ui";
import { bookFixture, recordUnavailability } from "@/features/operations/calendar-actions";

export function UnavailabilityForm({ resources }: { resources: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(recordUnavailability, null);
  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <Field label="Resource">
        <Select name="resourceId" searchable required>
          {resources.map((resource) => (
            <option key={resource.id} value={resource.id}>{resource.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Reason">
        <Select name="reason" defaultValue="leave">
          <option value="leave">Leave</option>
          <option value="sickness">Sickness</option>
          <option value="off_road">Van off road</option>
          <option value="service">Service</option>
          <option value="mot">MOT</option>
          <option value="other">Other</option>
        </Select>
      </Field>
      <Field label="From"><DateField name="starts" required /></Field>
      <Field label="To"><DateField name="ends" required /></Field>
      <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Mark unavailable"}</Button>
      {state ? <div className="md:col-span-2"><Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner></div> : null}
    </form>
  );
}

export function BookFixtureForm({
  jobs,
  resources,
}: {
  jobs: { id: string; label: string }[];
  resources: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(bookFixture, null);
  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <Field label="Fixture job">
        <Select name="jobId" searchable required>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>{job.label}</option>
          ))}
        </Select>
      </Field>
      <Field label="Resource">
        <Select name="resourceId" searchable required>
          {resources.map((resource) => (
            <option key={resource.id} value={resource.id}>{resource.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Day"><DateField name="day" required /></Field>
      <Field label="Hold">
        <Select name="kind" defaultValue="pencil">
          <option value="pencil">Hold</option>
          <option value="firm">Booked</option>
        </Select>
      </Field>
      <Button type="submit" disabled={pending || jobs.length === 0}>{pending ? "Booking..." : "Book"}</Button>
      {state ? <div className="md:col-span-2"><Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner></div> : null}
    </form>
  );
}
