import { connection } from "next/server";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { enGB } from "date-fns/locale";
import { FieldFrame } from "@/components/field/frame";
import { loadCompanyCalendar } from "@/features/people/calendar";
import { getCurrentProfile } from "@/lib/auth";
import { calendarTypeLabel, coversDay } from "@/lib/company-calendar";
import { isFixtureMode, isSupabaseConfigured } from "@/lib/env";
import { oneParam } from "@/lib/utils";

export const metadata = { title: "Calendar" };

function iso(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export default function FieldCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<FieldFrame title="Calendar" back={{ href: "/field", label: "Jobs" }}><p className="text-grey">Loading...</p></FieldFrame>}>
      <Calendar searchParams={searchParams} />
    </Suspense>
  );
}

async function Calendar({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  if (!isSupabaseConfigured() && !isFixtureMode()) {
    return <FieldFrame title="Calendar" back={{ href: "/field", label: "Jobs" }}><p>Add the Supabase keys, then open the calendar again.</p></FieldFrame>;
  }
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/field/calendar");
  if (!profile.access_granted) redirect("/no-access");
  if (!profile.is_active) redirect("/account-inactive");
  const params = await searchParams;
  const view = oneParam(params.view) === "week" ? "week" : "month";
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(oneParam(params.on) ?? "") ? new Date(`${oneParam(params.on)}T12:00:00`) : new Date();
  const start = view === "week" ? startOfWeek(anchor, { weekStartsOn: 1 }) : startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
  const end = view === "week" ? endOfWeek(anchor, { weekStartsOn: 1 }) : endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 });
  const calendar = await loadCompanyCalendar(iso(start), iso(end));
  const days = eachDayOfInterval({ start, end });
  const previous = view === "week" ? new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - 7) : addMonths(anchor, -1);
  const next = view === "week" ? new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 7) : addMonths(anchor, 1);
  const href = (date: Date, nextView = view) => {
    const search = new URLSearchParams({ on: iso(date) });
    if (nextView === "week") search.set("view", "week");
    return `/field/calendar?${search.toString()}`;
  };

  return (
    <FieldFrame title="Calendar" back={{ href: "/field", label: "Jobs" }}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link className="inline-flex min-h-11 items-center rounded-full border border-line px-3 text-sm font-semibold" href={href(previous)}>Previous</Link>
        <p className="font-semibold">{format(anchor, view === "week" ? "'Week of' d MMM" : "MMMM yyyy", { locale: enGB })}</p>
        <Link className="inline-flex min-h-11 items-center rounded-full border border-line px-3 text-sm font-semibold" href={href(next)}>Next</Link>
        <Link className="text-sm font-semibold underline" href={href(anchor, view === "week" ? "month" : "week")}>{view === "week" ? "Month" : "Week"}</Link>
      </div>
      <div className={`grid gap-1 ${view === "week" ? "grid-cols-1 sm:grid-cols-7" : "grid-cols-7"}`}>
        {days.map((day) => {
          const key = iso(day);
          const rows = calendar.items.filter((item) => coversDay(item, key));
          return (
            <div key={key} className="min-h-16 rounded-xl border border-line bg-card p-1">
              <p className="text-[11px] font-semibold">{format(day, "d", { locale: enGB })}</p>
              <ul>
                {rows.map((row) => (
                  <li key={`${row.source}-${row.id}`} className="truncate text-[11px]">
                    {row.name ?? "Company"} · {calendarTypeLabel(row.entryType)}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </FieldFrame>
  );
}
