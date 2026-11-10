import { Button, Input, Select } from "@/components/pulse/ui";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState } from "@/components/pulse/states";
import { inviteWorkspaceUser, saveWorkspaceUser } from "@/features/workspace/actions";
import { requireWorkspaceAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PULSE_MODULE_IDS } from "@/lib/types";

export const metadata = { title: "Users" };

const ROLES = [
  ["owner", "Owner"],
  ["admin", "Admin"],
  ["manager", "Manager"],
  ["member", "Member"],
  ["viewer", "Viewer"],
] as const;
const LEVELS = [
  ["none", "None"],
  ["view", "View"],
  ["edit", "Edit"],
] as const;

type DirectoryUser = {
  id: string;
  email: string;
  full_name: string | null;
  workspace_role: string;
  access_mode: "follow" | "custom";
  is_active: boolean;
  teams: string[];
  effective: Record<string, string>;
};

export default async function WorkspaceUsersPage() {
  await requireWorkspaceAdmin();
  const supabase = await createClient();
  const [{ data: peopleData }, { data: teamData }] = await Promise.all([
    supabase.rpc("workspace_directory"),
    supabase.rpc("workspace_teams"),
  ]);
  const people = (Array.isArray(peopleData) ? peopleData : []) as DirectoryUser[];
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
          <span className="mb-1 block text-grey">Name</span>
          <Input name="fullName" required />
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
          <li key={person.id} className="rounded-3xl border border-line bg-card p-5">
            <form action={saveWorkspaceUser} className="space-y-3">
              <input type="hidden" name="userId" value={person.id} />
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-semibold text-ink">{person.full_name || person.email}</p>
                  <p className="text-sm text-grey">{person.email}</p>
                </div>
                <p className="text-sm text-grey">
                  {PULSE_MODULE_IDS.map((moduleId) => `${moduleId.charAt(0).toUpperCase()}${moduleId.slice(1)} ${LEVELS.find(([value]) => value === (person.effective?.[moduleId] ?? "none"))?.[1] ?? "None"}`).join(" · ")}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Select name="workspaceRole" defaultValue={person.workspace_role} aria-label="Role">
                  {ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
                <Select name="accessMode" defaultValue={person.access_mode} aria-label="Access mode">
                  <option value="follow">Access follows team & role</option>
                  <option value="custom">Custom access</option>
                </Select>
                <Select name="isActive" defaultValue={person.is_active ? "yes" : "no"} aria-label="Active">
                  <option value="yes">Active</option>
                  <option value="no">Deactivated</option>
                </Select>
              </div>
              <fieldset>
                <legend className="mb-1 text-sm text-grey">Teams: {person.teams.join(", ") || "None"}</legend>
                <div className="flex flex-wrap gap-3">
                  {teams.map((team) => (
                    <label key={team.id} className="flex items-center gap-2 text-sm">
                      <Checkbox name="teamId" value={team.id} defaultChecked={person.teams.includes(team.name)} aria-label={team.name} />
                      {team.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-2 sm:grid-cols-3">
                {PULSE_MODULE_IDS.map((moduleId) => (
                  <label key={moduleId} className="text-sm">
                    <span className="mb-1 block text-grey">{moduleId.charAt(0).toUpperCase()}{moduleId.slice(1)}</span>
                    <Select name={`level-${moduleId}`} defaultValue={person.effective?.[moduleId] ?? "none"}>
                      {LEVELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </Select>
                  </label>
                ))}
              </div>
              <Button type="submit" variant="secondary">Save</Button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
