import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { addWeeks, format, startOfWeek } from "date-fns";
import { enGB } from "date-fns/locale";
import { UnavailabilityForm } from "@/components/calendar-forms";
import { PageHeader } from "@/components/pulse/page-header";
import { PageSkeleton } from "@/components/pulse/states";
import { loadSchedule } from "@/features/operations/office-pulse";
import { requireOperationsUser } from "@/lib/auth";
import { oneParam } from "@/lib/utils";

export const metadata = { title: "Schedule" };

function iso(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export default function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Schedule searchParams={searchParams} />
    </Suspense>
  );
}

async function Schedule({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  await requireOperationsUser();
  const params = await searchParams;
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(oneParam(params.on) ?? "") ? new Date(`${oneParam(params.on)}T12:00:00`) : new Date();
  const start = startOfWeek(anchor, { weekStartsOn: 1 });
  const days = [0, 1, 2, 3, 4].map((offset) => {
    const day = new Date(start);
    day.setDate(start.getDate() + offset);
    return day;
  });
  const schedule = await loadSchedule(iso(days[0]), iso(days[4]));
  const href = (date: Date) => `/operations/schedule?on=${iso(date)}`;
  const rows = [
    ...schedule.engineers.map((person) => ({ kind: "engineer" as const, id: person.id, label: person.name })),
    ...schedule.vans.map((van) => ({ kind: "van" as const, id: van.id, label: van.makeModel ? `${van.registration} · ${van.makeModel}` : van.registration })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Pulse Operations" title="Schedule" />
      {schedule.error ? <p className="text-sm">{schedule.error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Link className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold" href={href(addWeeks(anchor, -1))}>Previous</Link>
        <p className="font-display text-2xl">{format(start, "'Week of' dd/MM/yyyy", { locale: enGB })}</p>
        <Link className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold" href={href(addWeeks(anchor, 1))}>Next</Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-40 px-2 py-2 text-left text-xs font-semibold text-grey"> </th>
              {days.map((day) => (
                <th key={iso(day)} className="px-2 py-2 text-left text-xs font-semibold">{format(day, "EEE d", { locale: enGB })}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.kind}-${row.id}`} className="border-t border-line align-top">
                <th className="px-2 py-2 text-left font-semibold">{row.label}</th>
                {days.map((day) => {
                  const key = iso(day);
                  const events = schedule.events.filter((event) => event.rowKind === row.kind && event.rowId === row.id && event.day === key);
                  return (
                    <td key={key} className="px-2 py-2">
                      <ul className="space-y-1">
                        {events.map((event, index) => (
                          <li key={`${event.kind}-${event.label}-${index}`} className={event.kind === "absence" ? "text-red" : ""}>
                            {event.href ? <Link className="underline" href={event.href}>{event.label}</Link> : <span>{event.label.replaceAll("_", " ")}</span>}
                          </li>
                        ))}
                      </ul>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {schedule.engineers.length > 0 ? (
        <section className="rounded-3xl border border-line bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Absence</h2>
          <UnavailabilityForm resources={schedule.engineers} />
        </section>
      ) : null}
    </div>
  );
}
