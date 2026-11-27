import { MembersTable } from "@/components/members-table";
import { PendingInvites } from "@/components/pending-invites";
import { PageHeader } from "@/components/pulse/page-header";
import { WorkspaceInviteForm } from "@/components/workspace-invite-form";
import type { FieldResourceOption } from "@/components/workspace-user-card";
import { denyWorkspace, requireWorkspaceAdmin } from "@/lib/auth";
import { invitesIncludingNeverSignedIn, type MemberRow } from "@/lib/members";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Members" };

export default async function MembersPage() {
  await requireWorkspaceAdmin();
  const supabase = await createClient();
  const [peopleResult, teamResult, inviteResult, resourceResult] = await Promise.all([
    supabase.rpc("workspace_member_list"),
    supabase.rpc("workspace_teams"),
    supabase.rpc("workspace_pending_invites"),
    supabase.rpc("install_field_resources"),
  ]);
  if (peopleResult.error) {
    denyWorkspace(peopleResult.error);
    throw new Error(peopleResult.error.message);
  }
  if (teamResult.error) {
    denyWorkspace(teamResult.error);
    throw new Error(teamResult.error.message);
  }
  if (inviteResult.error) {
    denyWorkspace(inviteResult.error);
    throw new Error(inviteResult.error.message);
  }
  const peopleData = peopleResult.data;
  const teamData = teamResult.data;
  const inviteData = inviteResult.data;
  const people = (Array.isArray(peopleData) ? peopleData : []) as MemberRow[];
  const teams = (Array.isArray(teamData) ? teamData : []) as { id: string; name: string }[];
  const grants = (Array.isArray(inviteData) ? inviteData : []) as { email: string; full_name: string | null; role: string }[];
  const invites = invitesIncludingNeverSignedIn(grants, people);
  const directory = resourceResult.data as { resources?: FieldResourceOption[] } | null;
  const resources = !resourceResult.error && Array.isArray(directory?.resources) ? directory.resources : [];
  const installsTeamId = teams.find((team) => team.name === "Installs")?.id ?? "";

  return (
    <div className="space-y-8">
      <PageHeader title="Members" />
      <WorkspaceInviteForm teams={teams} resources={resources} installsTeamId={installsTeamId} />
      <PendingInvites invites={invites} />
      <MembersTable people={people} teams={teams.map((team) => team.name)} />
    </div>
  );
}
