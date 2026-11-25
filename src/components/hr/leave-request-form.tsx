"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button, Input } from "@/components/pulse/ui";
import { bookedWorkingDays } from "@/lib/hr/leave";

export function LeaveRequestForm() {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [startHalf, setStartHalf] = useState(false);
  const [endHalf, setEndHalf] = useState(false);
  const days = useMemo(() => {
    if (!start || !end || end < start) return null;
    return bookedWorkingDays(start, end, [], { startHalf, endHalf });
  }, [start, end, startHalf, endHalf]);

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        toast.success("Request sent");
      }}
    >
      <label className="text-sm font-semibold">
        From
        <Input className="mt-1" type="date" required value={start} onChange={(event) => setStart(event.target.value)} aria-label="From" />
      </label>
      <label className="text-sm font-semibold">
        To
        <Input className="mt-1" type="date" required value={end} onChange={(event) => setEnd(event.target.value)} aria-label="To" />
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={startHalf} onChange={(event) => setStartHalf(event.target.checked)} />
        Half day at the start
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={endHalf} onChange={(event) => setEndHalf(event.target.checked)} />
        Half day at the end
      </label>
      <p className="text-sm font-semibold">{days == null ? "Days" : `${days} days`}</p>
      <Button type="submit" className="min-h-11">Request time off</Button>
    </form>
  );
}
