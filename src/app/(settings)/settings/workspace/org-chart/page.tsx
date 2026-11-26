import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/pulse/page-header";
import { requireWorkspaceAdmin } from "@/lib/auth";
import { positionRows, seatLabel, type OrgPerson, type OrgPosition } from "@/lib/org-chart";
import { createClient } from "@/lib/supabase/server";
import { cn, oneParam } from "@/lib/utils";

export const metadata = { title: "Org chart" };

const TABS = ["Chart", "List", "Positions"] as const;

export default function OrgChartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={null}>
      <OrgChartBody searchParams={searchParams} />
    </Suspense>
  );
}

async function OrgChartBody({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireWorkspaceAdmin();
  const params = await searchParams;
  const tab = TABS.includes(oneParam(params.tab) as (typeof TABS)[number]) ? (oneParam(params.tab) as (typeof TABS)[number]) : "Chart";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("org_chart");
  if (error) throw new Error(error.message);
  const chart = (data ?? {}) as { positions?: OrgPosition[]; people?: OrgPerson[] };
  const positions = chart.positions ?? [];
  const people = chart.people ?? [];
  const unassigned = people.filter((person) => !person.position_id);

  return (
    <div className="space-y-6">
      <PageHeader title="Org chart" />
      <nav className="flex flex-wrap gap-2" aria-label="Org chart">
        {TABS.map((item) => (
          <Link
            key={item}
            href={item === "Chart" ? "/settings/workspace/org-chart" : `/settings/workspace/org-chart?tab=${item}`}
            aria-current={tab === item ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              tab === item ? "bg-red text-white" : "border border-line text-ink",
            )}
          >
            {item}
          </Link>
        ))}
      </nav>
      {tab === "Chart" ? (
        <ul className="space-y-2">
          {unassigned.length > 0 ? (
            <li className="rounded-2xl border border-line bg-card px-4 py-3">
              <p className="text-sm font-semibold">Unassigned</p>
              <p className="text-sm text-grey">{unassigned.map((person) => person.name).join(", ")}</p>
            </li>
          ) : null}
          {positionRows(positions).map(({ position, depth }) => (
            <li key={position.id} className="rounded-2xl border border-line bg-card px-4 py-3" style={{ marginLeft: depth * 16 }}>
              <p className="font-semibold">{position.title}</p>
              <p className="text-sm text-grey">{seatLabel(position.holders)}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {tab === "List" ? (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-grey">
              <th className="py-2 pr-3 font-semibold">Name</th>
              <th className="py-2 pr-3 font-semibold">Company</th>
              <th className="py-2 pr-3 font-semibold">Manager</th>
              <th className="py-2 font-semibold">Lead</th>
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.id} className="border-b border-line">
                <td className="py-3 pr-3 font-semibold">{person.name}{person.director ? " · Director" : ""}</td>
                <td className="py-3 pr-3">{person.company ?? "—"}</td>
                <td className="py-3 pr-3">{person.manager ?? "—"}</td>
                <td className="py-3">{person.lead ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {tab === "Positions" ? (
        <ul className="space-y-2">
          {positions.map((position) => (
            <li key={position.id} className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-line bg-card px-4 py-3">
              <span className="font-semibold">{position.title}</span>
              <span className="text-sm text-grey">{seatLabel(position.holders)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
