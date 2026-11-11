"use client";

import { useState } from "react";
import { format } from "date-fns";
import { enGB } from "date-fns/locale";
import { useRouter } from "next/navigation";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/pulse/ui";
import { moveInstall, setInstallStatus } from "@/features/sales/install-actions";

const STATUSES = [
  ["booked", "Booked"],
  ["scheduled", "Scheduled"],
  ["in_progress", "In progress"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
] as const;

export function InstallOpsControls({
  installId,
  status,
  canEdit,
}: {
  installId: string;
  status: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [nextStatus, setNextStatus] = useState(status);
  const [start, setStart] = useState<Date | undefined>();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  if (!canEdit) return null;

  async function saveStatus() {
    setPending(true);
    const result = await setInstallStatus(installId, nextStatus);
    setMessage(result.message);
    setPending(false);
    if (result.ok) router.refresh();
  }

  async function saveDates() {
    if (!start) return;
    setPending(true);
    const iso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
    const result = await moveInstall(installId, iso);
    setMessage(result.message);
    setPending(false);
    if (result.ok) router.refresh();
  }

  return (
    <section className="rounded-3xl border border-line bg-card px-6 py-5">
      <h2 className="font-display text-2xl">Change this install</h2>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <div>
          <p className="text-sm font-semibold">Status</p>
          <select className="mt-2 h-11 w-full rounded-2xl border border-line bg-field px-3" value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}>
            {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <Button className="mt-3" type="button" disabled={pending} onClick={saveStatus}>Update status</Button>
        </div>
        <div>
          <p className="text-sm font-semibold">Move dates</p>
          <p className="mt-1 text-sm text-grey">{start ? `New start ${format(start, "dd/MM/yyyy", { locale: enGB })}` : "Choose a new start date. dd/mm/yyyy"}</p>
          <Calendar
            mode="single"
            locale={enGB}
            weekStartsOn={1}
            selected={start}
            onSelect={setStart}
            className="mt-2"
          />
          <Button className="mt-3" type="button" disabled={pending || !start} onClick={saveDates}>Move dates</Button>
        </div>
      </div>
      {message ? <p className="mt-4 text-sm">{message}</p> : null}
    </section>
  );
}
