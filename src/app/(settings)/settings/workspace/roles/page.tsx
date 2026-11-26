import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/pulse/page-header";
import { denyWorkspace, requireWorkspaceAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn, oneParam } from "@/lib/utils";

export const metadata = { title: "Access" };

const TABS = ["Roles", "Pulse access", "Team defaults"] as const;

const ROLES = ["Owner", "Admin", "Member", "Guest"];

export default function RolesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={null}>
      <RolesBody searchParams={searchParams} />
    </Suspense>
  );
}

async function RolesBody({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireWorkspaceAdmin();
  const params = await searchParams;
  const requested = oneParam(params.tab);
  const tab = TABS.find((item) => item === requested) ?? "Roles";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("workspace_teams");
  denyWorkspace(error);
  const teams = (Array.isArray(data) ? data : []) as { id: string; name: string; members: number }[];

  return (
    <div className="space-y-6">
      <PageHeader title="Access" />
      <nav className="flex flex-wrap gap-2" aria-label="Access">
        {TABS.map((item) => (
          <Link
            key={item}
            href={item === "Roles" ? "/settings/workspace/roles" : `/settings/workspace/roles?tab=${encodeURIComponent(item)}`}
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
      {tab === "Roles" ? (
        <ul className="space-y-2">
          {ROLES.map((name) => (
            <li key={name} className="flex min-h-11 items-center rounded-2xl border border-line bg-card px-4 py-3 font-semibold">{name}</li>
          ))}
        </ul>
      ) : null}
      {tab === "Pulse access" ? (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-grey">
              <th className="py-2 pr-3 font-semibold">Pulse</th>
              <th className="py-2 pr-3 font-semibold">Owner</th>
              <th className="py-2 pr-3 font-semibold">Admin</th>
              <th className="py-2 font-semibold">Member</th>
            </tr>
          </thead>
          <tbody>
            {["People", "Operations", "Sales", "Logistics", "Policies"].map((pulse) => (
              <tr key={pulse} className="border-b border-line">
                <td className="py-3 pr-3 font-semibold">{pulse}</td>
                <td className="py-3 pr-3">Admin</td>
                <td className="py-3 pr-3">Admin</td>
                <td className="py-3">Team</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {tab === "Team defaults" ? (
        <ul className="space-y-2">
          {teams.map((team) => (
            <li key={team.id} className="flex min-h-11 items-center justify-between rounded-2xl border border-line bg-card px-4 py-3">
              <span className="font-semibold">{team.name}</span>
              <span className="text-sm text-grey">{team.members} people</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
