"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { Banner, Button } from "@/components/ui";
import { loadBookingDays, pencilJobDay } from "@/features/operations/price-actions";

export function BookingModal({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const [days, setDays] = useState<{ date: string; available: boolean }[]>([]);
  const [note, setNote] = useState("Loading the calendar…");
  const [state, action, pending] = useActionState(pencilJobDay, null);

  useEffect(() => {
    let active = true;
    loadBookingDays(jobId).then((result) => {
      if (!active) return;
      setDays(result.days);
      setNote(result.ok ? "Choose an available day. This pencils the job for the office to confirm." : result.message);
    });
    return () => {
      active = false;
    };
  }, [jobId]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-4 sm:items-center" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="booking-title" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-paper p-6 text-ink shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="booking-title" className="font-display text-3xl">Book a day</h2>
            <p className="mt-2 text-sm text-grey">{note}</p>
          </div>
          <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {days.map((day) => {
            const label = new Date(`${day.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
            if (!day.available) {
              return (
                <div key={day.date} className="rounded-2xl border border-line bg-card px-3 py-3 text-sm text-grey">
                  <span className="block font-semibold text-ink">{label}</span>
                  <span className="mt-2 block text-xs">Unavailable</span>
                </div>
              );
            }
            return (
              <form key={day.date} action={action}>
                <input type="hidden" name="jobId" value={jobId} />
                <input type="hidden" name="day" value={day.date} />
                <button type="submit" disabled={pending} className="h-full w-full rounded-2xl border border-red bg-card px-3 py-3 text-left text-sm text-ink hover:bg-red hover:text-white">
                  <span className="block font-semibold">{label}</span>
                  <span className="mt-2 block text-xs">Available</span>
                </button>
              </form>
            );
          })}
        </div>
        {state ? <div className="mt-4"><Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner></div> : null}
      </div>
    </div>
  );
}
