import { PageHeader } from "@/components/pulse/page-header";
import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export const instant = false;
export const metadata = { title: "Security policy" };

export default async function WorkspaceSecurityPage() {
  const profile = await requireUser();
  if (profile.workspace_role !== "owner") redirect("/settings/account/security");
  return (
    <div className="max-w-lg space-y-4">
      <PageHeader title="Security" />
      <p className="text-sm font-semibold">Two-step is required for owners, admins, directors, managers and guests after 7 days.</p>
      <p className="text-sm text-grey">An email code does not open salaries or cases. Those need an authenticator app.</p>
    </div>
  );
}
