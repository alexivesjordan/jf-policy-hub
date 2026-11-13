import { Suspense } from "react";
import Link from "next/link";
import { CancelBookingButton } from "@/components/cancel-booking";
import { InstallAccessPanel } from "@/components/install-access-panel";
import { InstallSalesView } from "@/components/install-sales-view";
import { SubcontractorInstallSection } from "@/components/subcontractor-install-section";
import { PageSkeleton } from "@/components/pulse/states";
import { InstallVisitPhotos } from "@/components/install-visit-photos";
import { installProposalUrl, listVisitPhotos, readInstall } from "@/features/sales/install-actions";
import { requireSalesUser } from "@/lib/auth";
import { canCancelInstall } from "@/lib/installs/access-auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Install" };

export default function SalesInstallPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SalesInstall params={params} />
    </Suspense>
  );
}

async function SalesInstall({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireSalesUser();
  const { id } = await params;
  const loaded = await readInstall(id);
  if (!loaded.ok || !loaded.install) {
    return <p>{loaded.message || "That install was not found."}</p>;
  }
  const proposalUrl = await installProposalUrl(loaded.install.proposalPath);
  const photos = await listVisitPhotos(id);
  const supabase = await createClient();
  const office = await supabase.rpc("orbit_office_context");
  const engineer = (office.data as { ops_role?: string } | null)?.ops_role === "installer";
  const canCancel = canCancelInstall({
    profile,
    bookingRepId: typeof loaded.install.bookingRepId === "string" ? loaded.install.bookingRepId : null,
    status: String(loaded.install.status ?? ""),
    stage: String(loaded.install.stage ?? ""),
    fieldEngineer: engineer,
  });
  return (
    <div className="space-y-4">
      <Link href="/sales/installs" className="text-sm font-semibold underline decoration-primary">All installs</Link>
      <InstallSalesView
        install={loaded.install}
        proposalUrl={proposalUrl}
        cancel={canCancel ? <CancelBookingButton installId={id} /> : null}
      />
      <InstallAccessPanel install={loaded.install} />
      <InstallVisitPhotos photos={photos} />
      <SubcontractorInstallSection profile={profile} install={loaded.install} />
    </div>
  );
}
