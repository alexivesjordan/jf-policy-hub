"use client";

import { useActionState, useState } from "react";
import { Button, Input } from "@/components/pulse/ui";
import { FormStatus } from "@/components/hr/form-status";
import { openCase } from "@/features/hr/actions";

export function OpenCaseForm({ people }: { people: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(openCase, null);
  const [route, setRoute] = useState("manager");
  return (
    <form action={action} className="mx-auto max-w-lg space-y-4">
      <label className="block text-sm font-semibold">
        Type
        <select className="mt-1 h-11 w-full rounded-2xl border border-line bg-field px-3" aria-label="Type" name="type" defaultValue="grievance">
          <option value="disciplinary">Disciplinary</option>
          <option value="grievance">Grievance</option>
          <option value="performance">Performance</option>
          <option value="health">Health</option>
          <option value="flexible_working">Flexible working</option>
        </select>
      </label>
      <label className="block text-sm font-semibold">
        Subject
        <select className="mt-1 h-11 w-full rounded-2xl border border-line bg-field px-3" aria-label="Subject" name="subject" required defaultValue={people[0]?.id ?? ""}>
          {people.length === 0 ? <option value="">No one to choose</option> : null}
          {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select>
      </label>
      <label className="block text-sm font-semibold">
        Title
        <Input className="mt-1" name="title" aria-label="Title" required />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Route</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="radio" name="route" value="manager" checked={route === "manager"} onChange={() => setRoute("manager")} />
          Manager
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="radio" name="route" value="director_only" checked={route === "director_only"} onChange={() => setRoute("director_only")} />
          Director only
        </label>
      </fieldset>
      <Button type="submit" disabled={pending || people.length === 0}>{pending ? "Opening…" : "Open"}</Button>
      <FormStatus state={state} />
    </form>
  );
}
