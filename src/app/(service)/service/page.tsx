import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { addDays, format, startOfWeek } from "date-fns";
import { enGB } from "date-fns/locale";
import { ServiceBoardView } from "@/components/service/board";
import { DuePlans } from "@/components/service/due-plans";
import { NewVisitLink } from "@/components/service/new-visit-link";
import { PageHeader } from "@/components/pulse/page-header";
import { PageSkeleton } from "@/components/pulse/states";
import { loadDuePlans, loadServiceBoard } from "@/features/service/queries";
import { requireServiceUser } from "@/lib/auth";
import { moduleAllows } from "@/lib/access";
import { oneParam } from "@/lib/utils";

export const metadata = { title: "Service board" };

function iso(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export default function ServiceBoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Board searchParams={searchParams} />
    </Suspense>
  );
}

async function Board({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const profile = await requireServiceUser();
  const canEdit = moduleAllows(profile, "service", "edit");
  const params = await searchParams;
  const view = oneParam(params.view);
  const mode = view === "week" ? "week" : view === "due" ? "due" : "day";
  const within = oneParam(params.within) === "60" ? 60 : 30;
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(oneParam(params.on) ?? "") ? new Date(`${oneParam(params.on)}T12:00:00`) : new Date();
  const start = mode === "week" ? startOfWeek(anchor, { weekStartsOn: 1 }) : anchor;
  const span = mode === "week" ? 6 : 0;
  const days = Array.from({ length: span + 1 }, (_, offset) => {
    const day = addDays(start, offset);
    return { iso: iso(day), label: format(day, "EEE d", { locale: enGB }) };
  });
  const board = mode === "due" ? null : await loadServiceBoard(days[0].iso, days[days.length - 1].iso);
  const due = mode === "due" ? await loadDuePlans(within) : null;
  const href = (next: Date, nextMode: "day" | "week" = mode === "week" ? "week" : "day") => `/service?view=${nextMode}&on=${iso(next)}`;
  const tabClass = "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold";
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        eyebrow="Pulse Service"
        title="Board"
        actions={canEdit ? <NewVisitLink day={days[0].iso} /> : null}
      />
      {board?.error ? <p className="text-sm">{board.error}</p> : null}
      {due?.error ? <p className="text-sm">{due.error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {mode !== "due" ? (
          <>
            <Link className={`${tabClass} border-line`} href={href(addDays(anchor, mode === "week" ? -7 : -1))}>Previous</Link>
            <p className="font-display text-2xl">{mode === "week" ? format(start, "'Week of' dd/MM/yyyy", { locale: enGB }) : format(anchor, "EEEE d MMM", { locale: enGB })}</p>
            <Link className={`${tabClass} border-line`} href={href(addDays(anchor, mode === "week" ? 7 : 1))}>Next</Link>
          </>
        ) : null}
        <Link className={`${tabClass} ${mode === "day" ? "border-foreground bg-card" : "border-line"}`} href={href(anchor, "day")} aria-current={mode === "day" ? "page" : undefined}>Day</Link>
        <Link className={`${tabClass} ${mode === "week" ? "border-foreground bg-card" : "border-line"}`} href={href(anchor, "week")} aria-current={mode === "week" ? "page" : undefined}>Week</Link>
        <Link className={`${tabClass} ${mode === "due" ? "border-foreground bg-card" : "border-line"}`} href="/service?view=due" aria-current={mode === "due" ? "page" : undefined}>Due</Link>
      </div>
      {mode === "due" && due ? <DuePlans plans={due.plans} within={within} canEdit={canEdit} /> : null}
      {board && board.stops.length === 0 && board.conflicts.length === 0 && !board.error ? <p className="text-sm text-grey">No visits</p> : null}
      {board ? <ServiceBoardView board={board} days={days} mode={mode === "week" ? "week" : "day"} /> : null}
    </div>
  );
}
