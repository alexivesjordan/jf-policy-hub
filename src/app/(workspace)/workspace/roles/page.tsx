import { PageHeader } from "@/components/pulse/page-header";
import { requireWorkspaceAdmin } from "@/lib/auth";

export const metadata = { title: "Roles" };

const ROLES = [
  ["Owner", "Edit on every Pulse. Alex and Simon are owners."],
  ["Admin", "Edit on every Pulse. Can manage Workspace."],
  ["Manager", "At least view on every Pulse. A team grant of edit stays edit."],
  ["Member", "Uses the team grants as they are. No grant means no access."],
  ["Viewer", "A team grant is capped at view. A blank grant stays none."],
];

export default async function RolesPage() {
  await requireWorkspaceAdmin();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="Roles"
        description="These five roles are fixed. Access is the most permissive grant across a person’s teams, then raised or capped by the role. A user can instead be set to custom access."
      />
      <ul className="space-y-3">
        {ROLES.map(([name, detail]) => (
          <li key={name} className="rounded-3xl border border-line bg-card px-5 py-4">
            <p className="font-semibold text-ink">{name}</p>
            <p className="mt-1 text-sm text-grey">{detail}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
