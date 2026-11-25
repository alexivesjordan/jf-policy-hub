"use client";

import { useActionState, useState } from "react";
import { Button, Input } from "@/components/pulse/ui";
import { FormStatus } from "@/components/hr/form-status";
import { reportSickness } from "@/features/hr/actions";

const reasons = ["Illness", "Injury", "Other"];

export function SicknessForm() {
  const [state, action, pending] = useActionState(reportSickness, null);
  const [reason, setReason] = useState(reasons[0]);
  return (
    <form action={action} className="mx-auto max-w-md space-y-4">
      <label className="block text-sm font-semibold">
        First day
        <Input className="mt-1" type="date" name="start" required aria-label="First day" defaultValue={new Date().toISOString().slice(0, 10)} />
      </label>
      <label className="block text-sm font-semibold">
        Reason
        <select className="mt-1 h-11 w-full rounded-2xl border border-line bg-field px-3" name="reason" value={reason} onChange={(event) => setReason(event.target.value)} aria-label="Reason">
          {reasons.map((item) => <option key={item}>{item}</option>)}
        </select>
      </label>
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "Sending…" : "Report"}</Button>
      <FormStatus state={state} />
    </form>
  );
}
