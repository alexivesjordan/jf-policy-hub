import { Button, Input, Select } from "@/components/ui";
import { inviteWorkspaceUser, saveWorkspaceUser } from "@/features/workspace/actions";
import { requireWorkspaceAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PULSE_MODULE_IDS } from "@/lib/types";

export const metadata = { title: "Users" };

const ROLES = ["owner", "admin", "manager", "member", "viewer"] as const;
const LEVELS = ["none", "view", "edit"] as const;

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
      <div>
        <h1 className="font-display text-4xl">Users</h1>
        <p className="mt-2 max-w-2xl text-grey">
          Invite with a Jordan Fitness email. Access follows the person’s teams and role unless you choose custom access. The row shows the effective level for each Pulse.
        </p>
      </div>
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
            {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
          </Select>
        </label>
        <div className="md:col-span-4">
          <Button type="submit">Send invite</Button>
        </div>
      </form>
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
                  {PULSE_MODULE_IDS.map((moduleId) => `${moduleId} ${person.effective?.[moduleId] ?? "none"}`).join(" · ")}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Select name="workspaceRole" defaultValue={person.workspace_role} aria-label="Role">
                  {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
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
                      <input type="checkbox" name="teamId" value={team.id} defaultChecked={person.teams.includes(team.name)} />
                      {team.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-2 sm:grid-cols-3">
                {PULSE_MODULE_IDS.map((moduleId) => (
                  <label key={moduleId} className="text-sm">
                    <span className="mb-1 block text-grey">{moduleId}</span>
                    <Select name={`level-${moduleId}`} defaultValue={person.effective?.[moduleId] ?? "none"}>
                      {LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
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
