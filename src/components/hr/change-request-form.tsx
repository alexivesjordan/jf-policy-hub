"use client";

import { useActionState } from "react";
import { Button, Input } from "@/components/pulse/ui";
import { FormStatus } from "@/components/hr/form-status";
import { submitChange } from "@/features/hr/actions";

export function ChangeRequestForm() {
  const [state, action, pending] = useActionState(submitChange, null);
  return (
    <form action={action} className="mt-4 grid gap-3 sm:grid-cols-[12rem_1fr_auto]">
      <label className="text-sm font-semibold">
        Detail
        <select name="field" aria-label="Detail" className="mt-1 h-11 w-full rounded-2xl border border-line bg-field px-3">
          <option value="phone">Phone</option>
          <option value="personal_email">Personal email</option>
          <option value="home_address">Home address</option>
          <option value="preferred_name">Preferred name</option>
          <option value="emergency_contacts">Emergency contact</option>
        </select>
      </label>
      <label className="text-sm font-semibold">
        New value
        <Input className="mt-1" name="value" aria-label="New value" required />
      </label>
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send"}</Button>
      </div>
      <div className="sm:col-span-3"><FormStatus state={state} /></div>
    </form>
  );
}
