"use client";

import { MonthBookingCalendar } from "@/components/month-booking-calendar";

export function AvailabilityCalendar({ jobId }: { jobId: string }) {
  return <MonthBookingCalendar jobId={jobId} />;
}
