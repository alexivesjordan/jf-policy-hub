"use client";

import { useActionState, useState } from "react";
import { FormStatus } from "@/components/hr/form-status";
import { Button, Field, Input } from "@/components/pulse/ui";
import { createJoiner } from "@/features/hr/joiner-actions";

const fieldClass = "mt-1 h-11 w-full rounded-2xl border border-line bg-field px-3";

export function JoinerForm({
  managers,
  canAddEngineer,
  startDate,
}: {
  managers: { id: string; name: string }[];
  canAddEngineer: boolean;
  startDate: string;
}) {
  const [state, action, pending] = useActionState(createJoiner, null);
  const [engineer, setEngineer] = useState(false);
  return (
    <form action={action} className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <Field label="Full name">
        <Input name="fullName" required autoComplete="name" />
      </Field>
      <Field label="Preferred name">
        <Input name="preferredName" autoComplete="nickname" />
      </Field>
      <Field label="Work email">
        <Input name="workEmail" type="email" autoComplete="off" placeholder="name@example.com" />
      </Field>
      <Field label="Phone">
        <Input name="phone" type="tel" autoComplete="off" />
      </Field>
      <Field label="Job title">
        <Input name="jobTitle" />
      </Field>
      <Field label="Department">
        <Input name="department" />
      </Field>
      <Field label="Location">
        <select className={fieldClass} name="location" aria-label="Location" defaultValue="office">
          <option value="office">Office</option>
          <option value="warehouse">Warehouse</option>
          <option value="field">Field</option>
        </select>
      </Field>
      <Field label="Start date">
        <Input name="start" type="date" required defaultValue={startDate} />
      </Field>
      <Field label="Line manager">
        <select className={fieldClass} name="manager" aria-label="Line manager" defaultValue="">
          <option value="">None</option>
          {managers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select>
      </Field>
      <Field label="Contract">
        <select className={fieldClass} name="contract" aria-label="Contract" defaultValue="Permanent">
          <option>Permanent</option>
          <option>Fixed term</option>
          <option>Casual</option>
        </select>
      </Field>
      <Field label="Hours per week">
        <Input name="hours" type="number" min={0} max={80} step="0.5" defaultValue="40" />
      </Field>
      <Field label="Notice">
        <Input name="notice" defaultValue="1 month" />
      </Field>
      {canAddEngineer ? (
        <div className="space-y-3 sm:col-span-2">
          <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              name="installEngineer"
              value="yes"
              className="size-5"
              checked={engineer}
              onChange={(event) => setEngineer(event.target.checked)}
            />
            Install engineer
          </label>
          {engineer ? (
            <Field label="Engineer role">
              <select className={fieldClass} name="engineerRole" aria-label="Engineer role" defaultValue="installer" required>
                <option value="installer">Installer</option>
                <option value="helper">Helper</option>
              </select>
            </Field>
          ) : null}
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add joiner"}</Button>
      </div>
      <div className="sm:col-span-2">
        <FormStatus state={state} />
      </div>
    </form>
  );
}
