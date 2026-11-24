"use client";

import { useActionState } from "react";
import { setRecordOwner } from "@/features/workspace/actions";
import { Button } from "@/components/pulse/ui";

export function OwnerPicker({
  kind,
  id,
  ownerId,
  people,
}: {
  kind: "job" | "install" | "quote" | "service_quote";
  id: string;
  ownerId: string | null;
  people: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(setRecordOwner, null);
  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="recordId" value={id} />
      <label className="text-sm">
        <span className="mb-1 block text-grey">Owner</span>
        <select name="ownerId" defaultValue={ownerId ?? ""} aria-label="Owner" className="min-h-11 rounded-xl border border-line bg-paper px-3">
          <option value="">Unassigned</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>{person.name}</option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving" : "Save owner"}</Button>
      {state?.message ? <p className="text-sm font-semibold text-red">{state.message}</p> : null}
    </form>
  );
}
