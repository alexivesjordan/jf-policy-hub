import { Suspense } from "react";
import { connection } from "next/server";
import { RoutePlanner } from "@/components/service/route-planner";
import { PageHeader } from "@/components/pulse/page-header";
import { PageSkeleton } from "@/components/pulse/states";
import { fillRoutePoints } from "@/features/service/actions";
import { loadRouteDay, loadServicePeople } from "@/features/service/queries";
import { requireServiceUser } from "@/lib/auth";
import { moduleAllows } from "@/lib/access";
import { londonToday } from "@/lib/format";
import { oneParam } from "@/lib/utils";

export const metadata = { title: "Routes" };

export default function ServiceRoutesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Routes searchParams={searchParams} />
    </Suspense>
  );
}

async function Routes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const profile = await requireServiceUser();
  const params = await searchParams;
  const people = await loadServicePeople();
  const requestedDay = oneParam(params.on) ?? "";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(requestedDay) ? requestedDay : londonToday();
  const requestedEngineer = oneParam(params.engineer) ?? "";
  const engineerId = people.some((person) => person.id === requestedEngineer) ? requestedEngineer : (people[0]?.id ?? "");
  const canEdit = moduleAllows(profile, "service", "edit");
  const loaded = engineerId ? await loadRouteDay(engineerId, day) : { stops: [], error: null as string | null };
  const stops = canEdit && !loaded.error ? await fillRoutePoints(loaded.stops) : loaded.stops;
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader eyebrow="Pulse Service" title="Routes" />
      {people.length === 0 ? <p className="text-sm text-grey">No engineers</p> : null}
      {loaded.error ? <p className="text-sm">{loaded.error}</p> : null}
      {engineerId ? (
        <RoutePlanner
          key={`${day}:${engineerId}`}
          day={day}
          engineerId={engineerId}
          engineers={people}
          stops={stops}
          canEdit={canEdit}
        />
      ) : null}
    </div>
  );
}
