"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button, Select } from "@/components/pulse/ui";
import { Checkbox } from "@/components/ui/checkbox";
import { saveWorkspaceUser } from "@/features/workspace/actions";
import { PULSE_MODULE_IDS } from "@/lib/types";

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

const TEAM_ORDER = ["Sales", "Installs", "Aftersales", "Operations", "Office", "Management"];

export type WorkspaceDirectoryUser = {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  full_name: string | null;
  workspace_role: string;
  access_mode: "follow" | "custom";
  is_active: boolean;
  teams: string[];
  effective: Record<string, string>;
};

function moduleLabel(moduleId: string) {
  return moduleId.charAt(0).toUpperCase() + moduleId.slice(1);
}

function levelFor(moduleId: string, effective: Record<string, string>) {
  return effective[moduleId] ?? "none";
}

export function WorkspaceUserCard({
  person,
  teams,
}: {
  person: WorkspaceDirectoryUser;
  teams: { id: string; name: string }[];
}) {
  const [role, setRole] = useState(person.workspace_role);
  const [mode, setMode] = useState<WorkspaceDirectoryUser["access_mode"]>(person.access_mode);
  const [levels, setLevels] = useState(() => Object.fromEntries(PULSE_MODULE_IDS.map((moduleId) => [moduleId, levelFor(moduleId, person.effective)])));
  const owner = role === "owner";
  const locked = owner || mode === "follow";
  const orderedTeams = [...teams].sort((a, b) => {
    const aIndex = TEAM_ORDER.indexOf(a.name);
    const bIndex = TEAM_ORDER.indexOf(b.name);
    return (aIndex === -1 ? TEAM_ORDER.length : aIndex) - (bIndex === -1 ? TEAM_ORDER.length : bIndex);
  });

  return (
    <li className="rounded-3xl border border-line bg-card p-5">
      <form action={saveWorkspaceUser} className="space-y-4">
        <input type="hidden" name="userId" value={person.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-grey">First name</span>
            <input name="firstName" required defaultValue={person.first_name ?? ""} className="w-full rounded-xl border border-line bg-paper px-3 py-2" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-grey">Last name</span>
            <input name="lastName" required defaultValue={person.last_name ?? ""} className="w-full rounded-xl border border-line bg-paper px-3 py-2" />
          </label>
          <p className="text-sm text-grey sm:col-span-2">{person.email}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Select name="workspaceRole" value={role} aria-label="Role" className="w-full sm:w-56" onChange={(event) => setRole(event.target.value)}>
            {ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <Select name="isActive" defaultValue={person.is_active ? "yes" : "no"} aria-label="Status" className="w-full sm:w-44">
            <option value="yes">Active</option>
            <option value="no">Deactivated</option>
          </Select>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink">Teams</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {orderedTeams.map((team) => (
              <label key={team.id} className="flex items-center gap-2 text-sm">
                <Checkbox name="teamId" value={team.id} defaultChecked={person.teams.includes(team.name)} aria-label={team.name} />
                {team.name}
              </label>
            ))}
          </div>
        </fieldset>
        <details className="group rounded-2xl border border-border">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden="true" />
            Access
          </summary>
          <div className="space-y-3 px-4 pb-4">
            <Select name="accessMode" value={mode} aria-label="Access mode" className="w-full sm:w-72" onChange={(event) => setMode(event.target.value === "custom" ? "custom" : "follow")}>
              <option value="follow">Access follows team & role</option>
              <option value="custom">Custom access</option>
            </Select>
            {owner ? <p className="text-sm text-grey">Owners can edit every Pulse.</p> : null}
            <div className="grid gap-2 sm:grid-cols-3">
              {PULSE_MODULE_IDS.map((moduleId) => {
                const shown = owner ? "edit" : mode === "follow" ? levelFor(moduleId, person.effective) : levels[moduleId];
                return (
                  <label key={moduleId} className="text-sm">
                    <span className="mb-1 block text-grey">{moduleLabel(moduleId)}</span>
                    <Select
                      name={`level-${moduleId}`}
                      value={shown}
                      disabled={locked}
                      aria-label={moduleLabel(moduleId)}
                      onChange={(event) => setLevels((current) => ({ ...current, [moduleId]: event.target.value }))}
                    >
                      {LEVELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </Select>
                  </label>
                );
              })}
            </div>
          </div>
        </details>
        <Button type="submit" variant="secondary">Save</Button>
      </form>
    </li>
  );
}
