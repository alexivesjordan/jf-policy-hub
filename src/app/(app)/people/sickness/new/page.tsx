"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/pulse/page-header";
import { Button, Input } from "@/components/pulse/ui";

const reasons = ["Illness", "Injury", "Other"];

export default function ReportSicknessPage() {
  const [reason, setReason] = useState(reasons[0]);
  return (
    <form
      className="mx-auto max-w-md space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        toast.success("Sickness reported");
      }}
    >
      <PageHeader eyebrow="Jordan Pulse" title="Report sickness" />
      <label className="block text-sm font-semibold">
        First day
        <Input className="mt-1" type="date" required aria-label="First day" defaultValue={new Date().toISOString().slice(0, 10)} />
      </label>
      <label className="block text-sm font-semibold">
        Reason
        <select className="mt-1 h-11 w-full rounded-2xl border border-line bg-field px-3" value={reason} onChange={(event) => setReason(event.target.value)} aria-label="Reason">
          {reasons.map((item) => <option key={item}>{item}</option>)}
        </select>
      </label>
      <Button type="submit" className="w-full">Report</Button>
    </form>
  );
}
