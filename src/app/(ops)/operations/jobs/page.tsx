import Link from "next/link";
import { Badge } from "@/components/ui";
import { listJobs } from "@/features/operations/queries";
import { formatDate } from "@/lib/format";
import { requireOperationsUser } from "@/lib/auth";

export const metadata = { title: "Jobs" };

export default async function JobsPage() {
  await requireOperationsUser();
  let jobs: Awaited<ReturnType<typeof listJobs>> = [];
  let error: string | null = null;
  try {
    jobs = await listJobs();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Could not load jobs.";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl">Jobs</h1>
        <p className="mt-2 max-w-2xl text-white/70">
          Status is read from the database. It cannot be edited here. Sales see their own jobs. The install lead, HQ, and the owner see the fixture set.
        </p>
      </div>
      {error ? <p className="rounded-3xl border border-red bg-card px-5 py-4">{error}</p> : null}
      {jobs.length === 0 && !error ? (
        <p className="rounded-3xl border border-dashed border-line bg-card px-5 py-8 text-white/70">
          No jobs for this role. Fixture jobs are visible to the install lead, HQ, and the owner. A sales role only sees jobs they own.
        </p>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link
                href={`/operations/jobs/${job.id}`}
                className="block rounded-3xl border border-line bg-card px-5 py-4 hover:border-red"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{job.customer_name}</p>
                  {job.fixture ? <Badge tone="pending">Fixture</Badge> : null}
                  <Badge tone="active">{job.status_label}</Badge>
                </div>
                <p className="mt-2 text-sm text-grey">
                  {job.cin7_number ?? "No Cin7 number"} · {job.city ?? "Site not set"} {job.postcode ?? ""}
                  {job.booked_date ? ` · Booked ${formatDate(job.booked_date)}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
