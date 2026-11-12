import Link from "next/link";
import { addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { enGB } from "date-fns/locale";
import { PageHeader } from "@/components/pulse/page-header";
import { listInstalls } from "@/features/sales/install-actions";

type InstallDay = { id: string; orderNumber: string; customerName: string; startOn: string; endOn: string };

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function iso(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export async function InstallCalendarPage({
  basePath,
  title,
  searchParams,
}: {
  basePath: "/sales/installs" | "/operations/installs";
  title: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const view = one(params.view) === "week" ? "week" : "month";
  const mine = one(params.mine) === "1";
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(one(params.on)) ? new Date(`${one(params.on)}T12:00:00`) : new Date();
  const start = view === "week" ? startOfWeek(anchor, { weekStartsOn: 1 }) : startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
  const end = view === "week" ? endOfWeek(anchor, { weekStartsOn: 1 }) : endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 });
  const listed = await listInstalls(iso(start), iso(end), mine);
  const installs = (listed.installs ?? []).map(asDay).filter((row) => row.id);
  const days = eachDayOfInterval({ start, end });
  const previous = view === "week" ? addWeeks(anchor, -1) : addMonths(anchor, -1);
  const next = view === "week" ? addWeeks(anchor, 1) : addMonths(anchor, 1);
  const query = (date: Date, nextView = view, nextMine = mine) => {
    const search = new URLSearchParams();
    search.set("on", iso(date));
    search.set("view", nextView);
    if (nextMine) search.set("mine", "1");
    return `${basePath}?${search.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={basePath.startsWith("/operations") ? "Pulse Operations" : "Pulse Sales"} title={title} />
      {listed.ok ? null : <p className="text-sm">{listed.message}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Link className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold" href={query(previous)}>Previous</Link>
        <p className="font-display text-2xl">{format(anchor, view === "week" ? "'Week of' dd/MM/yyyy" : "MMMM yyyy", { locale: enGB })}</p>
        <Link className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold" href={query(next)}>Next</Link>
        <Link className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ${view === "month" ? "bg-primary text-primary-foreground" : "border border-line"}`} href={query(anchor, "month")}>Month</Link>
        <Link className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ${view === "week" ? "bg-primary text-primary-foreground" : "border border-line"}`} href={query(anchor, "week")}>Week</Link>
        <Link className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ${mine ? "bg-primary text-primary-foreground" : "border border-line"}`} href={query(anchor, view, !mine)}>{mine ? "All installs" : "My installs"}</Link>
      </div>
      <div className={`grid gap-2 ${view === "week" ? "md:grid-cols-7" : "grid-cols-7"}`}>
        {view === "month" ? ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((label) => (
          <p key={label} className="px-1 text-xs font-semibold text-grey">{label}</p>
        )) : null}
        {days.map((day) => {
          const key = iso(day);
          const rows = installs.filter((row) => row.startOn <= key && row.endOn >= key);
          return (
            <div key={key} className="min-h-24 rounded-2xl border border-line bg-card p-2">
              <p className="text-xs font-semibold">{format(day, "dd/MM", { locale: enGB })}</p>
              <ul className="mt-1 space-y-1">
                {rows.map((row) => (
                  <li key={row.id}>
                    <Link className="block rounded-lg bg-muted px-2 py-1 text-xs font-semibold" href={`${basePath}/${row.id}`}>
                      {row.orderNumber}
                      <span className="mt-0.5 block font-normal text-grey">{row.customerName}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function asDay(row: Record<string, unknown>): InstallDay {
  return {
    id: String(row.id ?? ""),
    orderNumber: String(row.orderNumber ?? "Install"),
    customerName: String(row.customerName ?? ""),
    startOn: String(row.startOn ?? "").slice(0, 10),
    endOn: String(row.endOn ?? "").slice(0, 10),
  };
}
