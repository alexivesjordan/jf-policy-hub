import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PencilCalendar } from "@/components/pencil-calendar";
import { getJob, getJobRequirements } from "@/features/operations/queries";
import type { PoolResource } from "@/lib/orbit/availability";
import { requireOperationsUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Pencil a day" };

export default async function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireOperationsUser();
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const job = await getJob(id).catch(() => null);
  if (!job) notFound();
  const requirements = await getJobRequirements(id).catch(() => null);
  const start = new Date();
  const days = Array.from({ length: 21 }, (_, index) => iso(addDays(start, index)));
  const supabase = await createClient();
  const calendar = await supabase.rpc("orbit_calendar", { p_start: days[0], p_end: days[days.length - 1] });
  const data = (calendar.data ?? { resources: [], reservations: [], unavailability: [] }) as {
    resources: { id: string; name: string; resource_type: string; has_licence: boolean; insured: boolean }[];
    reservations: { resource_id: string; job_id: string; day: string }[];
    unavailability: { resource_id: string; starts_on: string; ends_on: string }[];
  };
  const resources: PoolResource[] = data.resources.map((resource) => ({
    id: resource.id,
    name: resource.name,
    resourceType: resource.resource_type,
    hasLicence: resource.has_licence,
    insured: resource.insured,
  }));
  const busyByDay: Record<string, string[]> = {};
  for (const day of days) {
    const busy = new Set<string>();
    for (const row of data.reservations) {
      if (row.job_id !== id && String(row.day).startsWith(day)) busy.add(row.resource_id);
    }
    for (const row of data.unavailability) {
      if (day >= row.starts_on && day <= row.ends_on) busy.add(row.resource_id);
    }
    busyByDay[day] = [...busy];
  }

  return (
    <div className="space-y-6">
      <Link href={`/operations/jobs/${job.id}`} className="text-sm font-semibold text-ink underline decoration-red">
        Back to the job
      </Link>
      <div>
        <h1 className="font-display text-4xl">Pencil a day</h1>
        <p className="mt-2 max-w-2xl text-ink/70">
          {job.customer.name}. A highlighted day is one where every required resource is free. The booking is a pencil for the office to confirm.
        </p>
      </div>
      {requirements ? (
        <PencilCalendar
          jobId={job.id}
          requirements={{
            installers: requirements.installers,
            licensedDrivers: requirements.licensed_drivers,
            vanSize: requirements.van_size,
            vanCount: requirements.van_count,
            stairClimber: requirements.stair_climber,
          }}
          resources={resources}
          busyByDay={busyByDay}
          days={days}
        />
      ) : (
        <p className="rounded-3xl border border-dashed border-line bg-card px-5 py-8 text-ink/70">
          This job has no required resources yet. Price the quote and create the job first.
        </p>
      )}
      {calendar.error ? <p className="text-sm text-ink">{calendar.error.message}</p> : null}
    </div>
  );
}

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}
