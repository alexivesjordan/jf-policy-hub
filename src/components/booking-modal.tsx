"use client";

import { AvailabilityCalendar } from "@/components/availability-calendar";
import { Button } from "@/components/ui";

export function BookingModal({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-4 sm:items-center" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="booking-title" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-paper p-6 text-ink shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <h2 id="booking-title" className="font-display text-3xl">Book a day</h2>
          <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
        </div>
        <div className="mt-6">
          <AvailabilityCalendar jobId={jobId} />
        </div>
      </div>
    </div>
  );
}
