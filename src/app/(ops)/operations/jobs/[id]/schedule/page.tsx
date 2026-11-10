import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { MonthBookingCalendar } from "@/components/month-booking-calendar";
import { getJob, getJobRequirements } from "@/features/operations/queries";
import { requireOperationsUser } from "@/lib/auth";

export const metadata = { title: "Pencil a day" };

export default async function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireOperationsUser();
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const job = await getJob(id).catch(() => null);
  if (!job) notFound();
  const requirements = await getJobRequirements(id).catch(() => null);

  return (
    <div className="space-y-6">
      <Link href={`/operations/jobs/${job.id}`} className="text-sm font-semibold text-ink underline decoration-red">
        Back to the job
      </Link>
      <div>
        <h1 className="font-display text-4xl">Pencil the install</h1>
        <p className="mt-2 max-w-2xl text-ink/70">
          {job.customer.name}. A green day can start the install. The booking is a pencil for the office to confirm.
        </p>
      </div>
      {requirements ? (
        <MonthBookingCalendar jobId={job.id} />
      ) : (
        <p className="rounded-3xl border border-dashed border-line bg-card px-5 py-8 text-ink/70">
          This job has no required resources yet. Price the quote and create the job first.
        </p>
      )}
    </div>
  );
}
