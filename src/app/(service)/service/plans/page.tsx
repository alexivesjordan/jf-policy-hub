import { Suspense } from "react";
import { connection } from "next/server";
import { PlanBoard } from "@/components/service/plan-board";
import { PageHeader } from "@/components/pulse/page-header";
import { PageSkeleton } from "@/components/pulse/states";
import { loadEligibleInstalls, loadMaintenancePlans } from "@/features/service/queries";
import { requireServiceUser } from "@/lib/auth";
import { moduleAllows } from "@/lib/access";

export const metadata = { title: "Plans" };

export default function ServicePlansPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Plans />
    </Suspense>
  );
}

async function Plans() {
  await connection();
  const profile = await requireServiceUser();
  const [plans, installs] = await Promise.all([loadMaintenancePlans(), loadEligibleInstalls()]);
  const error = plans.error ?? installs.error;
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader eyebrow="Pulse Service" title="Plans" />
      {error ? <p className="text-sm">{error}</p> : null}
      <PlanBoard plans={plans.plans} installs={installs.installs} canEdit={moduleAllows(profile, "service", "edit")} />
    </div>
  );
}
