import { Button, Input } from "@/components/ui";
import { deleteWorkspaceTeam, saveWorkspaceTeam } from "@/features/workspace/actions";
import { requireWorkspaceAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Teams" };

export default async function TeamsPage() {
  await requireWorkspaceAdmin();
  const supabase = await createClient();
  const { data } = await supabase.rpc("workspace_teams");
  const teams = (Array.isArray(data) ? data : []) as { id: string; name: string; members: number }[];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-4xl">Teams</h1>
      <p className="max-w-2xl text-ink/70">
        Starter teams are Sales, Installs, Aftersales, Operations, Office, and Management. Rename or add a team here. Deleting a team removes its memberships.
      </p>
      <form action={saveWorkspaceTeam} className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-grey">New team</span>
          <Input name="name" required placeholder="Aftersales" />
        </label>
        <Button type="submit">Create team</Button>
      </form>
      <ul className="space-y-3">
        {teams.map((team) => (
          <li key={team.id} className="flex flex-wrap items-end gap-3 rounded-3xl border border-line bg-card px-4 py-4">
            <form action={saveWorkspaceTeam} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="teamId" value={team.id} />
              <label className="text-sm">
                <span className="mb-1 block text-grey">{team.members} people</span>
                <Input name="name" defaultValue={team.name} required />
              </label>
              <Button type="submit" variant="secondary">Rename</Button>
            </form>
            <form action={deleteWorkspaceTeam}>
              <input type="hidden" name="teamId" value={team.id} />
              <Button type="submit" variant="danger">Delete</Button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
