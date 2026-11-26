import Link from "next/link";
import { PageHeader } from "@/components/pulse/page-header";
import { requireWorkspaceAdmin } from "@/lib/auth";

export const metadata = { title: "Workspace" };

export default async function WorkspaceHomePage() {
  await requireWorkspaceAdmin();
  return (
    <div className="space-y-6">
      <PageHeader title="Workspace" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Link href="/settings/workspace/members" className="flex min-h-11 items-center rounded-3xl border border-line bg-card p-5 font-semibold text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Members</Link>
        <Link href="/settings/workspace/teams" className="flex min-h-11 items-center rounded-3xl border border-line bg-card p-5 font-semibold text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Teams</Link>
        <Link href="/settings/workspace/roles" className="flex min-h-11 items-center rounded-3xl border border-line bg-card p-5 font-semibold text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Roles</Link>
      </div>
    </div>
  );
}
