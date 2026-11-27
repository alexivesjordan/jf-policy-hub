import Link from "next/link";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/pulse/page-header";
import { ServiceSheetNote } from "@/components/service/sheet-note";
import { VisitForm } from "@/components/service/visit-form";
import { fieldRole } from "@/features/field/queries";
import { loadServicePeople, loadServiceSheet, loadServiceVisit } from "@/features/service/queries";
import { moduleAllows } from "@/lib/access";
import { requireServiceUser } from "@/lib/auth";
import { visitFormInstanceKey } from "@/lib/service/form-key";
import { engineerJobPath, engineerPlannerRedirect } from "@/lib/service/visit-route";

export const instant = false;
export const metadata = { title: "Visit" };

export default async function ServiceVisitPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  let role = "none";
  try {
    role = await fieldRole();
  } catch {
    role = "none";
  }
  const job = engineerPlannerRedirect(role, `/service/visits/${id}`);
  if (job) redirect(job);
  const profile = await requireServiceUser();
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
      <PageHeader
        eyebrow="Pulse Service"
        title={visit.customerName}
        actions={<Link href={engineerJobPath(id)} className="inline-flex min-h-11 items-center text-sm font-semibold underline">Engineer view</Link>}
      />
      <ServiceSheetNote sheet={sheet} />
      <VisitForm key={visitFormInstanceKey(visit.id, null)} visit={visit} people={people} canEdit={moduleAllows(profile, "service", "edit")} />
    </div>
  );
}
