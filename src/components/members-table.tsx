"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Input, Select } from "@/components/pulse/ui";
import { memberMatches, memberName, pulseSummary, teamNames, type MemberRow } from "@/lib/members";

function signedIn(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export function MembersTable({ people, teams }: { people: MemberRow[]; teams: string[] }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [team, setTeam] = useState("");
  const [status, setStatus] = useState("");
  const rows = useMemo(
    () => people.filter((person) => memberMatches(person, { query, role, team, status })),
    [people, query, role, team, status],
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="text-sm font-semibold">
          Search
          <Input className="mt-1" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search" />
        </label>
        <label className="text-sm font-semibold">
          Role
          <Select className="mt-1" value={role} onChange={(event) => setRole(event.target.value)} aria-label="Role">
            <option value="">Any</option>
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
          </Select>
        </label>
        <label className="text-sm font-semibold">
          Team
          <Select className="mt-1" value={team} onChange={(event) => setTeam(event.target.value)} aria-label="Team">
            <option value="">Any</option>
            {teams.map((name) => <option key={name} value={name}>{name}</option>)}
          </Select>
        </label>
        <label className="text-sm font-semibold">
          Status
          <Select className="mt-1" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status">
            <option value="">Any</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </label>
      </div>
      {rows.length === 0 ? <p className="text-sm text-grey">No one matches.</p> : null}
      <div className="hidden md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-grey">
              <th className="py-2 pr-3 font-semibold">Name</th>
              <th className="py-2 pr-3 font-semibold">Role</th>
              <th className="py-2 pr-3 font-semibold">Teams</th>
              <th className="py-2 pr-3 font-semibold">Pulses</th>
              <th className="py-2 pr-3 font-semibold">Two-step</th>
              <th className="py-2 font-semibold">Last sign-in</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((person) => (
              <tr key={person.id} className="border-b border-line">
                <td className="py-1 pr-3">
                  <Link href={`/settings/workspace/members/${person.id}`} className="flex min-h-11 items-center font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                    {memberName(person)}
                  </Link>
                </td>
                <td className="py-1 pr-3 capitalize">{person.workspace_role}</td>
                <td className="py-1 pr-3">{teamNames(person).join(", ") || "—"}</td>
                <td className="py-1 pr-3">{pulseSummary(person.access) || "—"}</td>
                <td className="py-1 pr-3">{person.two_step ? "On" : "Off"}</td>
                <td className="py-1">{signedIn(person.last_sign_in_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 md:hidden">
        {rows.map((person) => (
          <li key={person.id}>
            <Link href={`/settings/workspace/members/${person.id}`} className="block min-h-11 rounded-2xl border border-line bg-card px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <span className="block font-semibold">{memberName(person)}</span>
              <span className="mt-1 block text-sm capitalize text-grey">{person.workspace_role} · {person.two_step ? "Two-step on" : "Two-step off"}</span>
              <span className="mt-1 block text-sm text-grey">{teamNames(person).join(", ") || "No team"}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
