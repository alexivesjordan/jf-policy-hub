"use client";

import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { useActionState } from "react";
import { Banner } from "@/components/pulse/ui";
import { Button } from "@/components/ui/button";
import { enGB } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { loadBookingWindow, pencilJobDay } from "@/features/operations/price-actions";
import type { PoolResource } from "@/lib/pulse/availability";
import { isWeekend, pencilConfirmLabel, planRange, type RangePlan } from "@/lib/pulse/booking-range";
import type { JobRequirements } from "@/lib/pulse/requirements";
import { cn } from "@/lib/utils";

function isoFromDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function dateFromIso(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function MonthBookingCalendar({ jobId }: { jobId: string }) {
  const [cursor, setCursor] = useState(() => new Date());
  const [installDays, setInstallDays] = useState(1);
  const [canAllowWeekends, setCanAllowWeekends] = useState(false);
  const [allowWeekends, setAllowWeekends] = useState(false);
  const [requirements, setRequirements] = useState<JobRequirements | null>(null);
  const [resources, setResources] = useState<PoolResource[]>([]);
  const [busyByDay, setBusyByDay] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState("Loading the calendar…");
  const [selected, setSelected] = useState<string | null>(null);
  const [state, action, pending] = useActionState(pencilJobDay, null);
  const today = isoFromDate(new Date());
  const key = monthKey(cursor);
  const weekends = allowWeekends && canAllowWeekends;

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

  function planFor(iso: string): RangePlan | null {
    if (!requirements || iso < today) return null;
    if (isWeekend(iso) && !weekends) return null;
    return planRange(requirements, resources, busyByDay, iso, installDays, weekends);
  }

  const chosen = selected ? planFor(selected) : null;
  const range = chosen
    ? { from: dateFromIso(chosen.dates[0]), to: dateFromIso(chosen.dates[chosen.dates.length - 1]) }
    : undefined;

  const plans = useMemo(() => {
    const map = new Map<string, RangePlan>();
    if (!requirements) return map;
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
      const iso = isoFromDate(day);
      const plan = planFor(iso);
      if (plan) map.set(iso, plan);
    }
    return map;
    // planFor closes over the loaded window. Recompute when that window changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirements, resources, busyByDay, cursor, installDays, weekends, today]);

  return (
    <div className="rounded-3xl border border-line bg-card px-4 py-5 text-ink sm:px-6">
      {canAllowWeekends ? (
        <label className="mb-3 flex min-h-11 items-center justify-center gap-3 text-sm font-semibold">
          <input
            type="checkbox"
            className="size-5 accent-red"
            checked={allowWeekends}
            onChange={(event) => {
              setAllowWeekends(event.target.checked);
              setSelected(null);
            }}
          />
          Allow weekends
        </label>
      ) : null}
      <Calendar
        mode="range"
        locale={enGB}
        weekStartsOn={1}
        month={cursor}
        onMonthChange={setCursor}
        selected={range}
        onSelect={(_next, trigger) => {
          if (!trigger) return;
          const iso = isoFromDate(trigger);
          const plan = plans.get(iso);
          if (plan?.selectable) setSelected(iso);
        }}
        disabled={(date) => {
          const iso = isoFromDate(date);
          if (iso < today) return true;
          if (isWeekend(iso) && !weekends) return true;
          return false;
        }}
        modifiers={{
          bookable: (date) => Boolean(plans.get(isoFromDate(date))?.selectable),
        }}
        modifiersClassNames={{ bookable: "day-bookable rounded-full" }}
        components={{
          DayButton: (props) => {
            const iso = isoFromDate(props.day.date);
            const plan = plans.get(iso);
            const button = <CalendarDay {...props} bookable={Boolean(plan?.selectable)} inRange={Boolean(chosen?.dates.includes(iso))} today={iso === today} />;
            if (!plan) return button;
            return (
              <HoverCard>
                <HoverCardTrigger render={button} />
                <HoverCardContent className="w-60">
                  {plan.lines.map((line) => (
                    <p key={line.id} className="flex items-start gap-2 py-1">
                      <span className={line.available ? "text-[#146c36]" : "text-red"} aria-hidden="true">{line.available ? "✓" : "✕"}</span>
                      <span>
                        <span className="font-semibold">{line.label}</span>
                        <span className="mt-0.5 block text-muted-foreground">{line.detail}</span>
                      </span>
                    </p>
                  ))}
                  {plan.lines.length === 0 ? <p className="text-muted-foreground">No resources are on the calendar yet.</p> : null}
                </HoverCardContent>
              </HoverCard>
            );
          },
        }}
        className="mx-auto w-full max-w-md [--cell-size:2.75rem]"
      />
      {note ? <p className="mt-4 text-sm text-grey">{note}</p> : null}
      <div className="mt-4" aria-live="polite">
        {chosen ? (
          <ul className="space-y-1">
            {chosen.lines.map((line) => (
              <li key={line.id} className="flex items-start gap-2 py-1 text-sm">
                <span className={line.available ? "text-[#146c36]" : "text-red"} aria-hidden="true">{line.available ? "✓" : "✕"}</span>
                <span>
                  <span className="font-semibold">{line.label}</span>
                  <span className="mt-0.5 block text-muted-foreground">{line.detail}</span>
                </span>
              </li>
            ))}
            {chosen.lines.length === 0 ? <li className="text-sm text-muted-foreground">No resources are on the calendar yet.</li> : null}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Tap a green day to see who is free. Arrow keys move between days.</p>
        )}
      </div>
      <form action={action} className="mt-5">
        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="day" value={selected ?? ""} />
        <input type="hidden" name="allowWeekends" value={weekends ? "yes" : "no"} />
        <Button type="submit" disabled={!chosen?.selectable || pending} className="min-h-11 w-full rounded-full">
          {pending ? "Pencilling…" : chosen ? pencilConfirmLabel(chosen.dates, weekends) : "Choose a start day"}
        </Button>
      </form>
      {state ? <div className="mt-4"><Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner></div> : null}
    </div>
  );
}

function CalendarDay({
  bookable,
  inRange,
  today,
  className,
  ...props
}: ComponentProps<"button"> & { bookable: boolean; inRange: boolean; today: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "flex size-11 min-h-11 min-w-11 items-center justify-center rounded-full text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        bookable && !inRange && "day-bookable",
        inRange && "day-selected",
        today && "day-today",
        className,
      )}
      {...props}
    />
  );
}
