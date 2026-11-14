"use client";

import { useActionState } from "react";
import { Button, Input, Select, TextArea } from "@/components/pulse/ui";
import { saveVan } from "@/features/operations/van-actions";

export type VanRow = {
  id: string;
  registration: string;
  name: string | null;
  makeModel?: string | null;
  motDue?: string | null;
  taxDue?: string | null;
  insuranceDue?: string | null;
  serviceDue?: string | null;
  notes?: string | null;
  active: boolean;
};

function day(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

function VanForm({ van }: { van?: VanRow }) {
  const [state, action, pending] = useActionState(saveVan, null);
  return (
    <form action={action} className="grid gap-3 rounded-3xl border border-line bg-card p-4 md:grid-cols-2">
      {van ? <input type="hidden" name="id" value={van.id} /> : null}
      <label className="text-sm">
        <span className="mb-1 block text-grey">Registration</span>
        <Input name="registration" required defaultValue={van?.registration ?? ""} autoCapitalize="characters" />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-grey">Make / model</span>
        <Input name="makeModel" defaultValue={van?.makeModel ?? ""} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-grey">Name</span>
        <Input name="name" defaultValue={van?.name ?? ""} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-grey">Status</span>
        <Select name="active" defaultValue={van && !van.active ? "no" : "yes"} aria-label="Status">
          <option value="yes">Active</option>
          <option value="no">Archived</option>
        </Select>
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-grey">MOT due</span>
        <Input name="motDue" type="date" defaultValue={day(van?.motDue)} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-grey">Tax due</span>
        <Input name="taxDue" type="date" defaultValue={day(van?.taxDue)} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-grey">Insurance renewal</span>
        <Input name="insuranceDue" type="date" defaultValue={day(van?.insuranceDue)} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-grey">Service due</span>
        <Input name="serviceDue" type="date" defaultValue={day(van?.serviceDue)} />
      </label>
      <label className="text-sm md:col-span-2">
        <span className="mb-1 block text-grey">Notes</span>
        <TextArea name="notes" defaultValue={van?.notes ?? ""} className="min-h-20" />
      </label>
      <div className="md:col-span-2">
        <Button type="submit" variant={van ? "secondary" : "primary"} disabled={pending}>{pending ? "Saving" : van ? "Save" : "Add vehicle"}</Button>
        {state?.message ? <p className="mt-2 text-sm font-semibold">{state.message}</p> : null}
      </div>
    </form>
  );
}

export function VansForm({ vans, canEdit }: { vans: VanRow[]; canEdit: boolean }) {
  return (
    <div className="space-y-4">
      {canEdit ? <VanForm /> : null}
      {vans.length === 0 ? <p className="text-sm text-grey">No vehicles yet.</p> : null}
      {vans.map((van) => canEdit ? <VanForm key={van.id} van={van} /> : (
        <article key={van.id} className="rounded-3xl border border-line bg-card px-4 py-3 text-sm">
          <p className="font-semibold">{van.registration}{van.makeModel ? ` · ${van.makeModel}` : ""}</p>
          <p className="text-grey">{van.active ? "Active" : "Archived"}</p>
        </article>
      ))}
    </div>
  );
}
