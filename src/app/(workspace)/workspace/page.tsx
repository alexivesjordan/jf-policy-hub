import Link from "next/link";
import { requireWorkspaceAdmin } from "@/lib/auth";

export const metadata = { title: "Workspace" };

export default async function WorkspaceHomePage() {
  await requireWorkspaceAdmin();
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-grey">Jordan Pulse</p>
        <h1 className="font-display mt-2 text-4xl">Workspace</h1>
        <p className="mt-2 max-w-2xl text-ink/70">
          Users, teams, and roles for the whole business. Each person has one role and can belong to more than one team.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Link href="/workspace/users" className="rounded-3xl border border-line bg-card p-5 font-semibold text-ink">Users</Link>
        <Link href="/workspace/teams" className="rounded-3xl border border-line bg-card p-5 font-semibold text-ink">Teams</Link>
        <Link href="/workspace/roles" className="rounded-3xl border border-line bg-card p-5 font-semibold text-ink">Roles</Link>
      </div>
    </div>
  );
}
