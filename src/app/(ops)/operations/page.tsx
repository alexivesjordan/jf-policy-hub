import Link from "next/link";
import { connection } from "next/server";
import { PageHeader } from "@/components/pulse/page-header";
import { loadOfficePulse, type OfficeJob } from "@/features/operations/office-pulse";
import { requireOperationsUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Install office" };

export default async function OperationsHomePage() {
  await connection();
  await requireOperationsUser();
  const pulse = await loadOfficePulse();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Pulse Operations" title="Overview" />
      {pulse.error ? <p className="text-sm">{pulse.error}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Bucket title="Today" jobs={pulse.installsToday} services={pulse.servicesToday} />
        <Bucket title="This week" jobs={pulse.installsWeek} services={pulse.servicesWeek} />
        <section className="rounded-3xl border border-line bg-card px-4 py-4">
          <h2 className="text-sm font-semibold">Off this week <span className="font-mono">{pulse.off.length}</span></h2>
          <Lines empty={pulse.off.length === 0} rows={pulse.off.map((item) => `${item.name} · ${item.label.replaceAll("_", " ")} · ${formatDate(item.startsOn)}`)} />
        </section>
        <section className="rounded-3xl border border-line bg-card px-4 py-4">
          <h2 className="text-sm font-semibold">Vans out <span className="font-mono">{pulse.vansOut.length}</span></h2>
          {pulse.vansOut.length === 0 ? <p className="mt-3 text-sm text-grey">None</p> : (
            <ul className="mt-2 divide-y divide-line">
              {pulse.vansOut.map((van) => (
                <li key={`${van.id}-${van.registration}`}>
                  <Link href={`/operations/installs/${van.id}`} className="block py-2 text-sm hover:underline">
                    <span className="font-semibold">{van.registration}</span>
                    <span className="text-grey"> · {van.orderNumber}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-3xl border border-line bg-card px-4 py-4">
          <h2 className="text-sm font-semibold">Overdue tasks <span className="font-mono">{pulse.overdue.length}</span></h2>
          {pulse.overdue.length === 0 ? <p className="mt-3 text-sm text-grey">None</p> : (
            <ul className="mt-2 divide-y divide-line">
              {pulse.overdue.map((task) => (
                <li key={task.id}>
                  <Link href="/operations/tasks" className="block py-2 text-sm hover:underline">
                    <span className="font-semibold">{task.title}</span>
                    {task.assignee ? <span className="text-grey"> · {task.assignee}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-3xl border border-line bg-card px-4 py-4">
          <h2 className="text-sm font-semibold">Warnings <span className="font-mono">{pulse.warnings.length}</span></h2>
          {pulse.warnings.length === 0 ? <p className="mt-3 text-sm text-grey">None</p> : (
            <ul className="mt-2 divide-y divide-line">
              {pulse.warnings.map((warning) => (
                <li key={`${warning.href}-${warning.label}-${warning.detail}`}>
                  <Link href={warning.href} className="block py-2 text-sm hover:underline">
                    <span className="font-semibold">{warning.label}</span>
                    <span className="text-grey"> · {warning.detail}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Bucket({ title, jobs, services }: { title: string; jobs: OfficeJob[]; services: OfficeJob[] }) {
  return (
    <section className="rounded-3xl border border-line bg-card px-4 py-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-grey">Installs {jobs.length}</h3>
      <JobLines jobs={jobs} />
      <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-grey">Service {services.length}</h3>
      <JobLines jobs={services} />
    </section>
  );
}

function JobLines({ jobs }: { jobs: OfficeJob[] }) {
  if (jobs.length === 0) return <p className="mt-1 text-sm text-grey">None</p>;
  return (
    <ul className="divide-y divide-line">
      {jobs.map((job) => (
        <li key={`${job.kind}-${job.id}`}>
          <Link href={job.kind === "job" ? `/operations/jobs/${job.id}` : `/operations/installs/${job.id}`} className="block py-2 text-sm hover:underline">
            <span className="font-semibold">{job.orderNumber}</span>
            {job.customerName ? <span className="text-grey"> · {job.customerName}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Lines({ rows, empty }: { rows: string[]; empty: boolean }) {
  if (empty) return <p className="mt-3 text-sm text-grey">None</p>;
  return (
    <ul className="mt-2 space-y-1">
      {rows.map((row) => <li key={row} className="text-sm">{row}</li>)}
    </ul>
  );
}
