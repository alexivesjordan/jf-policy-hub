import { connection } from "next/server";
import { PageHeader } from "@/components/pulse/page-header";
import { VisitForm } from "@/components/service/visit-form";
import { loadServicePeople } from "@/features/service/queries";
import { requireServiceUser } from "@/lib/auth";
import { moduleAllows } from "@/lib/access";
import { visitFormInstanceKey } from "@/lib/service/form-key";
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
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Pulse Service" title="New visit" />
      <VisitForm
        key={visitFormInstanceKey(null, draft)}
        visit={null}
        people={people}
        canEdit={moduleAllows(profile, "service", "edit")}
        preset={{ day, personId }}
      />
    </div>
  );
}
