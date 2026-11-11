import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { MonthBookingCalendar } from "@/components/month-booking-calendar";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState } from "@/components/pulse/states";
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
      <PageHeader
        eyebrow="Pulse Operations"
        title="Pencil the install"
        description={job.customer.name}
      />
      {requirements ? (
        <MonthBookingCalendar jobId={job.id} />
      ) : (
        <EmptyState title="This job has no required resources yet" description="Price the quote and create the job first." />
      )}
    </div>
  );
}
