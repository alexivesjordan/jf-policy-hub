import { connection } from "next/server";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/pulse/page-header";
import { VisitForm } from "@/components/service/visit-form";
import { loadServicePeople, loadServiceVisit } from "@/features/service/queries";
import { moduleAllows } from "@/lib/access";
import { requireServiceUser } from "@/lib/auth";

export const metadata = { title: "Visit" };

export default async function ServiceVisitPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const profile = await requireServiceUser();
  const { id } = await params;
  const [{ visit, error }, people] = await Promise.all([loadServiceVisit(id), loadServicePeople()]);
  if (!visit) {
    if (error === "That visit was not found.") notFound();
    return <p>{error}</p>;
  }
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Pulse Service" title={visit.customerName} />
      <VisitForm visit={visit} people={people} canEdit={moduleAllows(profile, "service", "edit")} />
    </div>
  );
}
