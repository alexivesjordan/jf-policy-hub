"use client";

import { MonthBookingCalendar } from "@/components/month-booking-calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function BookingModal({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto bg-paper sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl">Book a day</DialogTitle>
        </DialogHeader>
        <MonthBookingCalendar jobId={jobId} />
      </DialogContent>
    </Dialog>
  );
}
