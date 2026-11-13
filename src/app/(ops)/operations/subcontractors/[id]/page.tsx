import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { InsurancePanel, RemoveSubcontractor, SubcontractorForm } from "@/components/subcontractor-form";
import { PageHeader } from "@/components/pulse/page-header";
import { requireOperationsUser } from "@/lib/auth";
import { listSubcontractorRecords } from "@/features/subcontractors/queries";

export const metadata = { title: "Subcontractor" };

export default async function SubcontractorPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireOperationsUser();
  const { id } = await params;
  const rows = await listSubcontractorRecords().catch(() => []);
  const record = rows.find((row) => row.id === id);
  if (!record) notFound();
  return (
    <div className="space-y-6">
      <Link href="/operations/subcontractors" className="text-sm font-semibold underline">All subcontractors</Link>
      <PageHeader eyebrow="Pulse Operations" title={record.name} />
      <SubcontractorForm record={record} />
      <InsurancePanel record={record} today={new Date().toISOString().slice(0, 10)} />
      <RemoveSubcontractor id={record.id} />
    </div>
  );
}
