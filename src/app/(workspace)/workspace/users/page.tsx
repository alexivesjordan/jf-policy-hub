import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState } from "@/components/pulse/states";
import { WorkspaceInviteForm } from "@/components/workspace-invite-form";
import { WorkspaceUserCard, type FieldResourceOption, type WorkspaceDirectoryUser } from "@/components/workspace-user-card";
import { requireWorkspaceAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Users" };

export default async function WorkspaceUsersPage() {
  await requireWorkspaceAdmin();
  const supabase = await createClient();
  const [{ data: peopleData }, { data: teamData }, resourceResult] = await Promise.all([
    supabase.rpc("workspace_directory"),
    supabase.rpc("workspace_teams"),
    supabase.rpc("install_field_resources"),
  ]);
  const directory = resourceResult.data as { resources?: FieldResourceOption[]; officeIds?: string[] } | null;
  const resources = !resourceResult.error && Array.isArray(directory?.resources) ? directory.resources : null;
  const officeIds = Array.isArray(directory?.officeIds) ? directory.officeIds.filter((id) => typeof id === "string") : [];
  const teams = (Array.isArray(teamData) ? teamData : []) as { id: string; name: string }[];
  const installsTeamId = teams.find((team) => team.name === "Installs")?.id ?? "";
  const people = ((Array.isArray(peopleData) ? peopleData : []) as WorkspaceDirectoryUser[]).slice().sort((a, b) => {
    const last = (person: WorkspaceDirectoryUser) => (person.last_name || person.full_name?.split(" ").slice(-1)[0] || person.email).toLocaleLowerCase();
    const first = (person: WorkspaceDirectoryUser) => (person.first_name || person.full_name?.split(" ")[0] || "").toLocaleLowerCase();
    return last(a).localeCompare(last(b)) || first(a).localeCompare(first(b)) || a.email.localeCompare(b.email);
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Workspace"
        title="Users"
      />
      <WorkspaceInviteForm teams={teams} resources={resources ?? []} installsTeamId={installsTeamId} />
      {people.length === 0 ? <EmptyState title="No users yet" description="Send an invite with a Jordan Fitness email to add the first person." /> : null}
      <ul className="space-y-4">
        {people.map((person) => (
          <WorkspaceUserCard key={person.id} person={person} teams={teams} resources={resources ?? undefined} officeIds={officeIds} installsTeamId={installsTeamId} />
        ))}
      </ul>
    </div>
  );
}
