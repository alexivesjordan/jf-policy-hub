import { Suspense } from "react";
import Link from "next/link";
import { InstallAccessPanel } from "@/components/install-access-panel";
import { InstallOpsView } from "@/components/install-ops-view";
import { SubcontractorInstallSection } from "@/components/subcontractor-install-section";
import { PageSkeleton } from "@/components/pulse/states";
import { installProposalUrl, readInstall } from "@/features/sales/install-actions";
import { requireOperationsUser } from "@/lib/auth";
import { moduleAllows } from "@/lib/access";

export const metadata = { title: "Install" };

export default function OperationsInstallPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OpsInstall params={params} />
    </Suspense>
  );
}

async function OpsInstall({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireOperationsUser();
  const { id } = await params;
  const loaded = await readInstall(id);
  if (!loaded.ok || !loaded.install) {
    return <p>{loaded.message || "That install was not found."}</p>;
  }
  const proposalUrl = await installProposalUrl(loaded.install.proposalPath);
  return (
    <div className="space-y-4">
      <Link href="/operations/installs" className="text-sm font-semibold underline decoration-primary">All installs</Link>
      <InstallOpsView install={loaded.install} proposalUrl={proposalUrl} canEdit={moduleAllows(profile, "operations", "edit")} />
      <InstallAccessPanel install={loaded.install} />
      <SubcontractorInstallSection profile={profile} install={loaded.install} />
    </div>
  );
}
