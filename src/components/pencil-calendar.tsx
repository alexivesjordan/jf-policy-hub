"use client";

import { useActionState } from "react";
import { Banner, Button } from "@/components/ui";
import { pencilJobDay } from "@/features/operations/price-actions";
import { planDay, type PoolResource } from "@/lib/orbit/availability";
import type { JobRequirements } from "@/lib/orbit/requirements";

export function PencilCalendar({
  jobId,
  requirements,
  resources,
  busyByDay,
  days,
}: {
  jobId: string;
  requirements: JobRequirements;
  resources: PoolResource[];
  busyByDay: Record<string, string[]>;
  days: string[];
}) {
  const [state, action, pending] = useActionState(pencilJobDay, null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {days.map((day) => {
          const plan = planDay(requirements, resources, new Set(busyByDay[day] ?? []));
          const label = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
          if (!plan.selectable) {
            return (
              <button
                key={day}
                type="button"
                className="rounded-2xl border border-line bg-card px-3 py-3 text-left text-sm text-grey"
                title={plan.summary}
              >
                <span className="block font-semibold text-ink">{label}</span>
                <span className="mt-2 block text-xs leading-5">{plan.summary}</span>
              </button>
            );
          }
          return (
            <form key={day} action={action}>
              <input type="hidden" name="jobId" value={jobId} />
              <input type="hidden" name="day" value={day} />
              <button
                type="submit"
                disabled={pending}
                className="h-full w-full rounded-2xl border border-red bg-card px-3 py-3 text-left text-sm text-ink hover:bg-red hover:text-white"
                title={plan.summary}
              >
                <span className="block font-semibold">{label}</span>
                <span className="mt-2 block text-xs">All resources free</span>
              </button>
            </form>
          );
        })}
      </div>
      {state ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
    </div>
  );
}
