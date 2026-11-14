import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { enGB } from "date-fns/locale";
import { CalendarEntryForm } from "@/components/calendar-entry-form";
import { PageHeader } from "@/components/pulse/page-header";
import { PageSkeleton } from "@/components/pulse/states";
import { loadCompanyCalendar } from "@/features/people/calendar";
import { canManageWorkspace } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { calendarTypeLabel, coversDay } from "@/lib/company-calendar";
import { oneParam } from "@/lib/utils";

export const metadata = { title: "Calendar" };

function iso(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export default function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CalendarBody searchParams={searchParams} />
    </Suspense>
  );
}

async function CalendarBody({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const profile = await requireUser();
  const params = await searchParams;
  const view = oneParam(params.view) === "week" ? "week" : "month";
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(oneParam(params.on) ?? "") ? new Date(`${oneParam(params.on)}T12:00:00`) : new Date();
  const start = view === "week" ? startOfWeek(anchor, { weekStartsOn: 1 }) : startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
  const end = view === "week" ? endOfWeek(anchor, { weekStartsOn: 1 }) : endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 });
  const calendar = await loadCompanyCalendar(iso(start), iso(end));
  const days = eachDayOfInterval({ start, end });
  const previous = view === "week" ? addWeeks(anchor, -1) : addMonths(anchor, -1);
  const next = view === "week" ? addWeeks(anchor, 1) : addMonths(anchor, 1);
  const href = (date: Date, nextView = view) => {
    const search = new URLSearchParams();
    search.set("on", iso(date));
    if (nextView === "week") search.set("view", "week");
    return `/people/calendar?${search.toString()}`;
  };
  const editing = calendar.entries.find((row) => row.id === oneParam(params.edit));
  const admin = canManageWorkspace(profile);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Pulse People" title="Calendar" />
      {calendar.error ? <p className="text-sm">{calendar.error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Link className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold" href={href(previous)}>Previous</Link>
        <p className="font-display text-2xl">{format(anchor, view === "week" ? "'Week of' dd/MM/yyyy" : "MMMM yyyy", { locale: enGB })}</p>
        <Link className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold" href={href(next)}>Next</Link>
        <Link className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ${view === "month" ? "bg-primary text-primary-foreground" : "border border-line"}`} href={href(anchor, "month")}>Month</Link>
        <Link className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ${view === "week" ? "bg-primary text-primary-foreground" : "border border-line"}`} href={href(anchor, "week")}>Week</Link>
      </div>
      <div className={`grid gap-2 ${view === "week" ? "md:grid-cols-7" : "grid-cols-7"}`}>
        {days.map((day) => {
          const key = iso(day);
          const rows = calendar.items.filter((item) => coversDay(item, key));
          const inMonth = view === "week" || day.getMonth() === anchor.getMonth();
          return (
            <div key={key} className={`min-h-24 rounded-2xl border border-line bg-card p-2 ${inMonth ? "" : "opacity-50"}`}>
              <p className="text-xs font-semibold">{format(day, "EEE d", { locale: enGB })}</p>
              <ul className="mt-1 space-y-1">
                {rows.map((row) => (
                  <li key={`${row.source}-${row.id}`}>
                    {admin && row.source === "entry" ? (
                      <Link className="block truncate text-xs font-semibold underline" href={`${href(anchor)}&edit=${row.id}`}>
                        {row.name ?? "Company"} · {calendarTypeLabel(row.entryType)}
                      </Link>
                    ) : (
                      <p className="truncate text-xs">
                        {row.name ?? "Company"} · {calendarTypeLabel(row.entryType)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {admin ? (
        <section className="rounded-3xl border border-line bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">{editing ? "Edit entry" : "Add entry"}</h2>
          <CalendarEntryForm people={calendar.people} entry={editing ?? null} />
        </section>
      ) : null}
    </div>
  );
}
