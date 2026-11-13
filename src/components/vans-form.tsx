"use client";

import { useActionState } from "react";
import { Button, Input, Select } from "@/components/pulse/ui";
import { saveVan } from "@/features/operations/van-actions";

export type VanRow = { id: string; registration: string; name: string | null; active: boolean };

function VanForm({ van }: { van?: VanRow }) {
  const [state, action, pending] = useActionState(saveVan, null);
  return (
    <form action={action} className="grid gap-3 rounded-3xl border border-line bg-card p-4 sm:grid-cols-[1fr_1fr_9rem_auto] sm:items-end">
      {van ? <input type="hidden" name="id" value={van.id} /> : null}
      <label className="text-sm">
        <span className="mb-1 block text-grey">Registration</span>
        <Input name="registration" required defaultValue={van?.registration ?? ""} autoCapitalize="characters" />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-grey">Name</span>
        <Input name="name" defaultValue={van?.name ?? ""} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-grey">Active</span>
        <Select name="active" defaultValue={van && !van.active ? "no" : "yes"} aria-label="Active">
          <option value="yes">Active</option>
          <option value="no">Inactive</option>
        </Select>
      </label>
      <Button type="submit" variant={van ? "secondary" : "primary"} disabled={pending}>{pending ? "Saving" : van ? "Save" : "Add van"}</Button>
      {state?.message ? <p className="text-sm font-semibold text-red sm:col-span-4">{state.message}</p> : null}
    </form>
  );
}

export function VansForm({ vans }: { vans: VanRow[] }) {
  return (
    <div className="space-y-4">
      <VanForm />
      {vans.length === 0 ? <p className="text-sm text-grey">No vans yet.</p> : null}
      {vans.map((van) => <VanForm key={van.id} van={van} />)}
    </div>
  );
}
