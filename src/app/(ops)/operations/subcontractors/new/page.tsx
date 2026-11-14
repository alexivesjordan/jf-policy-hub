import { connection } from "next/server";
import { PageHeader } from "@/components/pulse/page-header";
import { SubcontractorForm } from "@/components/subcontractor-form";
import { requireOperationsUser } from "@/lib/auth";

export const metadata = { title: "Add subcontractor" };

export default async function NewSubcontractorPage() {
  await connection();
  await requireOperationsUser();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Pulse Operations" title="Add subcontractor" />
      <SubcontractorForm />
    </div>
  );
}
