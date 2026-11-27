import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/pulse/page-header";
import { ResendInviteButton } from "@/components/resend-invite-button";
import { WorkspaceUserCard, type FieldResourceOption, type WorkspaceDirectoryUser } from "@/components/workspace-user-card";
import { denyWorkspace, requireWorkspaceAdmin } from "@/lib/auth";
import { memberName, type MemberAccess, type MemberRow } from "@/lib/members";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata = { title: "Person" };

const TABS = ["Overview", "Access", "Teams", "Security", "Activity"] as const;

export default function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={null}>
      <MemberBody params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function MemberBody({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireWorkspaceAdmin();
  const { id } = await params;
  const query = await searchParams;
  const tab = String(query.tab ?? "Overview");
  const supabase = await createClient();
  const [memberResult, teamResult, resourceResult] = await Promise.all([
    supabase.rpc("workspace_member", { p_id: id }),
    supabase.rpc("workspace_teams"),
    supabase.rpc("install_field_resources"),
  ]);
  if (memberResult.error) {
    denyWorkspace(memberResult.error);
    throw new Error(memberResult.error.message);
  }
  const data = memberResult.data;
  const teamData = teamResult.data;
  if (!data || typeof data !== "object") notFound();
  const person = data as MemberRow;
  const teams = (Array.isArray(teamData) ? teamData : []) as { id: string; name: string }[];
  const directory = resourceResult.data as { resources?: FieldResourceOption[]; officeIds?: string[] } | null;
  const resources = !resourceResult.error && Array.isArray(directory?.resources) ? directory.resources : undefined;
  const officeIds = Array.isArray(directory?.officeIds) ? directory.officeIds.filter((value) => typeof value === "string") : [];
  const names = person.teams.map((team) => (typeof team === "string" ? team : team.name));
  const cardPerson: WorkspaceDirectoryUser = {
    id: person.id,
    email: person.email,
    first_name: person.first_name ?? undefined,
    last_name: person.last_name ?? undefined,
    full_name: person.full_name ?? null,
    workspace_role: person.workspace_role,
    access_mode: person.access_mode,
    is_active: person.is_active,
    teams: names,
    effective: Object.fromEntries((person.access ?? []).map((row) => [row.pulse, row.level])),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={memberName(person)}
        actions={person.last_sign_in_at ? undefined : <ResendInviteButton email={person.email} name={memberName(person)} />}
      />
      <nav className="flex flex-wrap gap-2" aria-label="Person">
        {TABS.map((item) => (
          <Link
            key={item}
            href={`/settings/workspace/members/${person.id}?tab=${item}`}
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
      {tab === "Access" ? <AccessTable access={person.access ?? []} /> : null}
      {tab === "Teams" ? (
        <ul className="space-y-2">
          {names.length === 0 ? <li className="text-sm text-grey">No team</li> : names.map((name) => <li key={name} className="text-sm font-semibold">{name}</li>)}
        </ul>
      ) : null}
      {tab === "Security" ? (
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-grey">Two-step</dt>
            <dd className="font-semibold">{person.two_step ? "On" : "Off"}</dd>
          </div>
          <div>
            <dt className="text-grey">Last sign-in</dt>
            <dd className="font-semibold">{person.last_sign_in_at ? new Date(person.last_sign_in_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—"}</dd>
          </div>
        </dl>
      ) : null}
      {tab === "Activity" ? <p className="text-sm text-grey">No activity yet</p> : null}
      {tab === "Overview" || !TABS.includes(tab as (typeof TABS)[number]) ? (
        <WorkspaceUserCard
          person={cardPerson}
          teams={teams}
          resources={resources}
          officeIds={officeIds}
          installsTeamId={teams.find((team) => team.name === "Installs")?.id ?? ""}
        />
      ) : null}
    </div>
  );
}

function AccessTable({ access }: { access: MemberAccess[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-line text-left text-grey">
          <th className="py-2 pr-3 font-semibold">Pulse</th>
          <th className="py-2 pr-3 font-semibold">Level</th>
          <th className="py-2 font-semibold">Source</th>
        </tr>
      </thead>
      <tbody>
        {access.map((row) => (
          <tr key={row.pulse} className="border-b border-line">
            <td className="py-3 pr-3 capitalize">{row.pulse}</td>
            <td className="py-3 pr-3 capitalize">{row.level}</td>
            <td className="py-3">{row.source}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
