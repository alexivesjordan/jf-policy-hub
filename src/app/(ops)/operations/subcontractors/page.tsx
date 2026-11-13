import Link from "next/link";
import { connection } from "next/server";
import { PageHeader } from "@/components/pulse/page-header";
import { Badge } from "@/components/pulse/ui";
import { requireOperationsUser } from "@/lib/auth";
import { emailNeedsCheck, insuranceInDate } from "@/lib/subcontractors/capability";
import { listSubcontractorRecords } from "@/features/subcontractors/queries";

export const metadata = { title: "Subcontractors" };

const STATUS: Record<string, string> = { active: "Active", preferred: "Preferred", on_hold: "On hold", inactive: "Inactive" };

export default async function SubcontractorsPage() {
  await connection();
  await requireOperationsUser();
  const today = new Date().toISOString().slice(0, 10);
  let rows: Awaited<ReturnType<typeof listSubcontractorRecords>> = [];
  let error = "";
  try {
    rows = await listSubcontractorRecords(true);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Could not load subcontractors.";
  }
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Pulse Operations" title="Subcontractors" actions={<Link className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground" href="/operations/subcontractors/new">Add subcontractor</Link>} />
      {error ? <p className="text-sm">{error}</p> : null}
      <ul className="space-y-3">
        {rows.map((row) => {
          const covered = insuranceInDate(row.insurance, today);
          return (
            <li key={row.id}>
              <Link href={`/operations/subcontractors/${row.id}`} className="block rounded-3xl border border-line bg-card px-5 py-4 hover:border-red">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{row.name}</span>
                  <Badge tone={row.status === "on_hold" ? "pending" : "neutral"}>{STATUS[row.status] ?? row.status}</Badge>
                  {covered ? <Badge tone="good">Insurance in date</Badge> : <Badge tone="bad">No in-date insurance</Badge>}
                  {emailNeedsCheck(row.emails) ? <Badge tone="pending">Check email</Badge> : null}
                </span>
                <span className="mt-2 block text-sm text-grey">{[row.contactName, row.emails.join(", "), row.phone, row.regions.join(", ") || "No area limit", row.jobTypes.join(", ")].filter(Boolean).join(" · ")}</span>
                {!covered ? <span className="mt-2 block text-sm font-semibold">Cannot be selected or emailed until insurance is in date.</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
