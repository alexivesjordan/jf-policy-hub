import { connection } from "next/server";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/pulse/page-header";
import { ServiceSheetNote } from "@/components/service/sheet-note";
import { VisitForm } from "@/components/service/visit-form";
import { loadServicePeople, loadServiceSheet, loadServiceVisit } from "@/features/service/queries";
import { moduleAllows } from "@/lib/access";
import { requireServiceUser } from "@/lib/auth";
import { visitFormInstanceKey } from "@/lib/service/form-key";

export const metadata = { title: "Visit" };

export default async function ServiceVisitPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const profile = await requireServiceUser();
  const { id } = await params;
  const [{ visit, error }, people, sheet] = await Promise.all([
    loadServiceVisit(id),
    loadServicePeople(),
    loadServiceSheet(id),
  ]);
  if (!visit) {
    if (error === "That visit was not found.") notFound();
    return <p>{error}</p>;
  }
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Pulse Service" title={visit.customerName} />
      <ServiceSheetNote sheet={sheet} />
      <VisitForm key={visitFormInstanceKey(visit.id, null)} visit={visit} people={people} canEdit={moduleAllows(profile, "service", "edit")} />
    </div>
  );
}
