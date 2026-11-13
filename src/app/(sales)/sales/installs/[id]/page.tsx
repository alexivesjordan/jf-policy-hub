import { Suspense } from "react";
import Link from "next/link";
import { InstallAccessPanel } from "@/components/install-access-panel";
import { InstallSalesView } from "@/components/install-sales-view";
import { PageSkeleton } from "@/components/pulse/states";
import { installProposalUrl, readInstall } from "@/features/sales/install-actions";
import { requireSalesUser } from "@/lib/auth";

export const metadata = { title: "Install" };

export default function SalesInstallPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SalesInstall params={params} />
    </Suspense>
  );
}

async function SalesInstall({ params }: { params: Promise<{ id: string }> }) {
  await requireSalesUser();
  const { id } = await params;
  const loaded = await readInstall(id);
  if (!loaded.ok || !loaded.install) {
    return <p>{loaded.message || "That install was not found."}</p>;
  }
  const proposalUrl = await installProposalUrl(loaded.install.proposalPath);
  return (
    <div className="space-y-4">
      <Link href="/sales/installs" className="text-sm font-semibold underline decoration-primary">All installs</Link>
      <InstallSalesView install={loaded.install} proposalUrl={proposalUrl} />
      <InstallAccessPanel install={loaded.install} />
    </div>
  );
}
