import { Button, Input, Select } from "@/components/pulse/ui";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState } from "@/components/pulse/states";
import { WorkspaceUserCard, type WorkspaceDirectoryUser } from "@/components/workspace-user-card";
import { inviteWorkspaceUser } from "@/features/workspace/actions";
import { requireWorkspaceAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Users" };

const ROLES = [
  ["owner", "Owner"],
  ["admin", "Admin"],
  ["manager", "Manager"],
  ["member", "Member"],
  ["viewer", "Viewer"],
] as const;

export default async function WorkspaceUsersPage() {
  await requireWorkspaceAdmin();
  const supabase = await createClient();
  const [{ data: peopleData }, { data: teamData }] = await Promise.all([
    supabase.rpc("workspace_directory"),
    supabase.rpc("workspace_teams"),
  ]);
  const people = ((Array.isArray(peopleData) ? peopleData : []) as WorkspaceDirectoryUser[]).slice().sort((a, b) => {
    const last = (person: WorkspaceDirectoryUser) => (person.last_name || person.full_name?.split(" ").slice(-1)[0] || person.email).toLocaleLowerCase();
    const first = (person: WorkspaceDirectoryUser) => (person.first_name || person.full_name?.split(" ")[0] || "").toLocaleLowerCase();
    return last(a).localeCompare(last(b)) || first(a).localeCompare(first(b)) || a.email.localeCompare(b.email);
  });
  const teams = (Array.isArray(teamData) ? teamData : []) as { id: string; name: string }[];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Workspace"
        title="Users"
        description="Invite colleagues and choose what they can open."
      />
      <form action={inviteWorkspaceUser} className="grid gap-3 rounded-3xl border border-line bg-card p-5 md:grid-cols-4">
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-grey">Email</span>
          <Input name="email" type="email" required placeholder="name@jordanfitness.com" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-grey">First name</span>
          <Input name="firstName" required autoComplete="given-name" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-grey">Last name</span>
          <Input name="lastName" required autoComplete="family-name" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-grey">Role</span>
          <Select name="workspaceRole" defaultValue="member">
            {ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </label>
        <div className="md:col-span-4">
          <Button type="submit">Send invite</Button>
        </div>
      </form>
      {people.length === 0 ? <EmptyState title="No users yet" description="Send an invite with a Jordan Fitness email to add the first person." /> : null}
      <ul className="space-y-4">
        {people.map((person) => (
          <WorkspaceUserCard key={person.id} person={person} teams={teams} />
        ))}
      </ul>
    </div>
  );
}
