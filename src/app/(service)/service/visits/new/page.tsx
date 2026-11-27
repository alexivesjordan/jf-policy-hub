import { connection } from "next/server";
import { PageHeader } from "@/components/pulse/page-header";
import { VisitForm } from "@/components/service/visit-form";
import { loadPlanPrefill, loadServicePeople } from "@/features/service/queries";
import { requireServiceUser } from "@/lib/auth";
import { moduleAllows } from "@/lib/access";
import { visitFormInstanceKey } from "@/lib/service/form-key";
import { planVisitSeed } from "@/lib/service/plan-dates";
import { oneParam } from "@/lib/utils";

export const metadata = { title: "New visit" };

export default async function NewServiceVisitPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const profile = await requireServiceUser();
  const params = await searchParams;
  const people = await loadServicePeople();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(oneParam(params.on) ?? "") ? oneParam(params.on) : undefined;
  const personId = oneParam(params.person);
  const draft = oneParam(params.draft);
  const planId = oneParam(params.plan);
  const prefill = planId ? await loadPlanPrefill(planId) : null;
  const seed = planVisitSeed(prefill);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Pulse Service" title="New visit" />
      {planId && !seed ? <p className="text-sm font-semibold text-red">That plan was not found.</p> : null}
      <VisitForm
        key={seed?.maintenancePlanId ? `plan:${seed.maintenancePlanId}:${draft ?? ""}` : visitFormInstanceKey(null, draft)}
        visit={null}
        people={people}
        canEdit={moduleAllows(profile, "service", "edit")}
        preset={{ day, personId, seed }}
      />
    </div>
  );
}
