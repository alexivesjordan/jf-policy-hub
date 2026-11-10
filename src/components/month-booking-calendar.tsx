"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Banner } from "@/components/ui";
import { loadBookingWindow, pencilJobDay } from "@/features/operations/price-actions";
import type { PoolResource } from "@/lib/pulse/availability";
import { isWeekend, pencilConfirmLabel, planRange, type RangePlan } from "@/lib/pulse/booking-range";
import type { JobRequirements } from "@/lib/pulse/requirements";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthCells(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1));
  const pad = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Array<string | null> = Array.from({ length: pad }, () => null);
  for (let day = 1; day <= days; day += 1) {
    cells.push(new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function MonthBookingCalendar({ jobId }: { jobId: string }) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  });
  const [installDays, setInstallDays] = useState(1);
  const [canAllowWeekends, setCanAllowWeekends] = useState(false);
  const [allowWeekends, setAllowWeekends] = useState(false);
  const [requirements, setRequirements] = useState<JobRequirements | null>(null);
  const [resources, setResources] = useState<PoolResource[]>([]);
  const [busyByDay, setBusyByDay] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState("Loading the calendar…");
  const [selected, setSelected] = useState<string | null>(null);
  const [state, action, pending] = useActionState(pencilJobDay, null);
  const today = todayIso();
  const key = monthKey(cursor);

  useEffect(() => {
    let active = true;
    loadBookingWindow(jobId, key).then((result) => {
      if (!active) return;
      setNote(result.ok ? "" : result.message);
      setInstallDays(result.installDays);
      setCanAllowWeekends(result.canAllowWeekends);
      setRequirements(result.requirements);
      setResources(result.resources);
      setBusyByDay(result.busyByDay);
    });
    return () => {
      active = false;
    };
  }, [jobId, key]);

  const cells = useMemo(
    () => monthCells(cursor.getUTCFullYear(), cursor.getUTCMonth()),
    [cursor],
  );
  const title = cursor.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const weekends = allowWeekends && canAllowWeekends;
  const chosen = selected && requirements
    ? planRange(requirements, resources, busyByDay, selected, installDays, weekends)
    : null;

  function planFor(iso: string): RangePlan | null {
    if (!requirements) return null;
    return planRange(requirements, resources, busyByDay, iso, installDays, weekends);
  }

  return (
    <div className="rounded-3xl border border-line bg-card px-4 py-5 text-ink sm:px-6">
      <div className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center">
        <button type="button" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-mist" aria-label="Previous month" onClick={() => setCursor(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - 1, 1)))}>
          <ChevronLeft aria-hidden="true" className="size-5" />
        </button>
        <h3 className="text-center font-display text-2xl">{title}</h3>
        <button type="button" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-mist" aria-label="Next month" onClick={() => setCursor(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1)))}>
          <ChevronRight aria-hidden="true" className="size-5" />
        </button>
      </div>
      {canAllowWeekends ? (
        <label className="mt-4 flex min-h-11 items-center justify-center gap-3 text-sm font-semibold">
          <input type="checkbox" className="size-5 accent-red" checked={allowWeekends} onChange={(event) => { setAllowWeekends(event.target.checked); setSelected(null); }} />
          Allow weekends
        </label>
      ) : null}
      <div className="mt-4 grid grid-cols-7 text-center text-xs font-semibold text-grey">
        {WEEKDAYS.map((label, index) => <div key={`${label}-${index}`} className="py-2">{label}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((iso, index) => {
          if (!iso) return <div key={`pad-${index}`} />;
          const past = iso < today;
          const weekend = isWeekend(iso);
          const lockedWeekend = weekend && !weekends;
          const plan = past || lockedWeekend ? null : planFor(iso);
          const bookable = Boolean(plan?.selectable);
          const inRange = Boolean(chosen?.dates.includes(iso));
          const className = [
            "relative mx-auto flex h-11 w-11 items-center justify-center rounded-full text-sm",
            past || lockedWeekend ? "cursor-default text-grey/60" : "cursor-pointer",
            bookable && !inRange ? "day-bookable" : "",
            inRange ? "day-selected" : "",
            iso === today ? "day-today" : "",
          ].join(" ");
          const body = <span>{Number(iso.slice(8))}</span>;
          if (past || (!plan && !lockedWeekend)) {
            return <div key={iso} className={className}>{body}</div>;
          }
          if (lockedWeekend || !plan) {
            return (
              <div key={iso} className="group relative">
                <button type="button" className={className}>{body}</button>
                <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-48 -translate-x-1/2 rounded-2xl border border-line bg-paper p-3 text-left text-xs text-grey shadow-lg group-hover:block group-focus-within:block">
                  Weekends are closed unless an owner allows them.
                </div>
              </div>
            );
          }
          return (
            <div key={iso} className="group relative">
              <button
                type="button"
                className={className}
                aria-pressed={inRange}
                aria-label={iso}
                onClick={() => {
                  if (bookable) setSelected(iso);
                }}
              >
                {body}
              </button>
              <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-56 -translate-x-1/2 rounded-2xl border border-line bg-paper p-3 text-left text-xs shadow-lg group-hover:block group-focus-within:block">
                {plan.lines.map((line) => (
                  <p key={line.id} className="flex items-start gap-2 py-1 text-ink">
                    <span className={line.available ? "text-[#146c36]" : "text-red"} aria-hidden="true">{line.available ? "✓" : "✕"}</span>
                    <span>
                      <span className="font-semibold">{line.label}</span>
                      <span className="mt-0.5 block text-grey">{line.detail}</span>
                    </span>
                  </p>
                ))}
                {plan.lines.length === 0 ? <p className="text-grey">No resources are on the calendar yet.</p> : null}
              </div>
            </div>
          );
        })}
      </div>
      {note ? <p className="mt-4 text-sm text-grey">{note}</p> : null}
      <form action={action} className="mt-5">
        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="day" value={selected ?? ""} />
        <input type="hidden" name="allowWeekends" value={weekends ? "yes" : "no"} />
        <button type="submit" disabled={!chosen?.selectable || pending} className="min-h-11 w-full rounded-full bg-ink px-4 py-3 text-sm font-semibold text-paper disabled:opacity-40">
          {pending ? "Pencilling…" : chosen ? pencilConfirmLabel(chosen.dates, weekends) : "Choose a start day"}
        </button>
      </form>
      {state ? <div className="mt-4"><Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner></div> : null}
    </div>
  );
}
