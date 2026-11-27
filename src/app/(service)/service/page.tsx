import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { addDays, format, startOfWeek } from "date-fns";
import { enGB } from "date-fns/locale";
import { ServiceBoardView } from "@/components/service/board";
import { NewVisitLink } from "@/components/service/new-visit-link";
import { PageHeader } from "@/components/pulse/page-header";
import { PageSkeleton } from "@/components/pulse/states";
import { loadServiceBoard } from "@/features/service/queries";
import { requireServiceUser } from "@/lib/auth";
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
  await requireServiceUser();
  const params = await searchParams;
  const mode = oneParam(params.view) === "week" ? "week" : "day";
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(oneParam(params.on) ?? "") ? new Date(`${oneParam(params.on)}T12:00:00`) : new Date();
  const start = mode === "week" ? startOfWeek(anchor, { weekStartsOn: 1 }) : anchor;
  const span = mode === "week" ? 6 : 0;
  const days = Array.from({ length: span + 1 }, (_, offset) => {
    const day = addDays(start, offset);
    return { iso: iso(day), label: format(day, "EEE d", { locale: enGB }) };
  });
  const board = await loadServiceBoard(days[0].iso, days[days.length - 1].iso);
  const href = (next: Date, nextMode = mode) => `/service?view=${nextMode}&on=${iso(next)}`;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pulse Service"
        title="Board"
        actions={board.canEdit ? <NewVisitLink day={days[0].iso} /> : null}
      />
      {board.error ? <p className="text-sm">{board.error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Link className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold" href={href(addDays(anchor, mode === "week" ? -7 : -1))}>Previous</Link>
        <p className="font-display text-2xl">{mode === "week" ? format(start, "'Week of' dd/MM/yyyy", { locale: enGB }) : format(anchor, "EEEE d MMM", { locale: enGB })}</p>
        <Link className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold" href={href(addDays(anchor, mode === "week" ? 7 : 1))}>Next</Link>
        <Link className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold" href={href(anchor, mode === "day" ? "week" : "day")}>{mode === "day" ? "Week" : "Day"}</Link>
      </div>
      {board.stops.length === 0 && board.conflicts.length === 0 && !board.error ? <p className="text-sm text-grey">No visits</p> : null}
      <ServiceBoardView board={board} days={days} mode={mode} />
    </div>
  );
}
