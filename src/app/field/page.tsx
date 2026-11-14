import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { FieldFrame } from "@/components/field/frame";
import { fieldHome, type FieldJob } from "@/features/field/queries";
import { getCurrentProfile } from "@/lib/auth";
import { isFixtureMode, isSupabaseConfigured } from "@/lib/env";
import { formatDate, londonToday } from "@/lib/format";

export const instant = false;
export const metadata = { title: "My jobs" };

export default function FieldHomePage() {
  return (
    <Suspense fallback={<FieldFrame title="My jobs"><p className="text-grey">Loading...</p></FieldFrame>}>
      <FieldHome />
    </Suspense>
  );
}

async function FieldHome() {
  await connection();
  if (!isSupabaseConfigured() && !isFixtureMode()) {
    return <FieldFrame title="My jobs"><p>Add the Supabase keys, then open My jobs again.</p></FieldFrame>;
  }
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/field");
  if (!profile.access_granted) redirect("/no-access");
  if (!profile.is_active) redirect("/account-inactive");

  let home: Awaited<ReturnType<typeof fieldHome>> | null = null;
  let problem: string | null = null;
  try {
    home = await fieldHome();
  } catch (error) {
    problem = error instanceof Error ? error.message : "Could not load your jobs.";
  }
  if (!home) {
    return <FieldFrame title="My jobs"><p>{problem}</p></FieldFrame>;
  }
  const today = londonToday();
  const groups = [
    { title: "Today", jobs: home.jobs.filter((job) => job.today) },
    { title: "Next", jobs: home.jobs.filter((job) => !job.today && job.startOn > today) },
    { title: "Earlier", jobs: home.jobs.filter((job) => !job.today && job.startOn <= today) },
  ];
  return (
    <FieldFrame title="My jobs">
      <div className="mb-4 flex justify-end">
        <div className="flex gap-4">
          <Link href="/operations/documents" className="inline-flex min-h-12 items-center text-base font-semibold underline decoration-red">
            Visit documents
          </Link>
          <Link href="/field/signature" className="inline-flex min-h-12 items-center text-base font-semibold underline decoration-red">
            My signature
          </Link>
        </div>
      </div>
      {home.needsLink ? <p className="text-base">Ask an admin to link your login.</p> : null}
      {!home.needsLink && home.jobs.length === 0 ? <p className="text-base">No jobs assigned.</p> : null}
      <div className="space-y-6">
        {groups.map((group) =>
          group.jobs.length === 0 ? null : (
            <section key={group.title} className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-grey">{group.title}</h2>
              <ul className="space-y-3">
                {group.jobs.map((job) => (
                  <li key={job.id}>
                    <JobCard job={job} />
                  </li>
                ))}
              </ul>
            </section>
          ),
        )}
      </div>
    </FieldFrame>
  );
}

function JobCard({ job }: { job: FieldJob }) {
  return (
    <Link href={`/field/${job.id}`} className="block rounded-3xl border border-line bg-card p-4">
      <p className="text-lg font-semibold">{job.customerName}</p>
      <p className="mt-1 text-base">{job.orderNumber}</p>
      {job.siteAddress ? <p className="mt-1 text-sm text-grey">{job.siteAddress}</p> : null}
      <p className="mt-2 text-sm text-grey">
        {formatDate(job.startOn)}
        {job.status === "completed" ? " · Done" : ""}
      </p>
      <span className="mt-3 inline-flex min-h-12 items-center text-base font-semibold text-red">Open</span>
    </Link>
  );
}
