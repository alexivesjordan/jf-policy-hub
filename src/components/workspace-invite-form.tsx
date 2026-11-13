"use client";

import { useActionState } from "react";
import { Button, Input, Select } from "@/components/pulse/ui";
import { Checkbox } from "@/components/ui/checkbox";
import { inviteWorkspaceUser } from "@/features/workspace/actions";
import type { FieldResourceOption } from "@/components/workspace-user-card";

const ROLES = [
  ["owner", "Owner"],
  ["admin", "Admin"],
  ["manager", "Manager"],
  ["member", "Member"],
  ["viewer", "Viewer"],
] as const;

export function WorkspaceInviteForm({
  teams,
  resources,
  installsTeamId,
}: {
  teams: { id: string; name: string }[];
  resources: FieldResourceOption[];
  installsTeamId: string;
}) {
  const [state, action, pending] = useActionState(inviteWorkspaceUser, null);
  return (
    <form action={action} className="grid gap-3 rounded-3xl border border-line bg-card p-5 md:grid-cols-4">
      <input type="hidden" name="installsTeamId" value={installsTeamId} />
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
      <fieldset className="md:col-span-4">
        <legend className="mb-2 text-sm font-semibold text-ink">Teams</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {teams.map((team) => (
            <label key={team.id} className="flex items-center gap-2 text-sm">
              <Checkbox name="teamId" value={team.id} aria-label={team.name} />
              {team.name}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="text-sm md:col-span-2">
        <span className="mb-1 block text-grey">Field engineer resource</span>
        <Select name="fieldResource" defaultValue="" aria-label="Field engineer resource">
          <option value="">Not a field engineer</option>
          <option value="office">Office user (not a field engineer)</option>
          {resources.map((resource) => (
            <option key={resource.id} value={resource.id}>{resource.name.replace(/^FIXTURE — /, "")}</option>
          ))}
        </Select>
      </label>
      <p className="text-sm text-grey md:col-span-4">Installs needs a resource, or office. Until an admin chooses, that person only sees My jobs.</p>
      {state?.message ? <p className="text-sm font-semibold text-red md:col-span-4">{state.message}</p> : null}
      <div className="md:col-span-4">
        <Button type="submit" disabled={pending}>{pending ? "Sending" : "Send invite"}</Button>
      </div>
    </form>
  );
}
