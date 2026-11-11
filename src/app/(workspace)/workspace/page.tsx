import Link from "next/link";
import { PageHeader } from "@/components/pulse/page-header";
import { requireWorkspaceAdmin } from "@/lib/auth";

export const metadata = { title: "Workspace" };

export default async function WorkspaceHomePage() {
  await requireWorkspaceAdmin();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Jordan Pulse"
        title="Workspace"
        description="Each person has one role and can belong to more than one team."
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Link href="/workspace/users" className="rounded-3xl border border-line bg-card p-5 font-semibold text-ink">Users</Link>
        <Link href="/workspace/teams" className="rounded-3xl border border-line bg-card p-5 font-semibold text-ink">Teams</Link>
        <Link href="/workspace/roles" className="rounded-3xl border border-line bg-card p-5 font-semibold text-ink">Roles</Link>
      </div>
    </div>
  );
}
