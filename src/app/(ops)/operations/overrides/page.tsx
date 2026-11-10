import { GateOverrideForm } from "@/components/operations-forms";
import { Card } from "@/components/pulse/ui";
import { PageHeader } from "@/components/pulse/page-header";
import { getOfficeContext, listGateOverrides, listJobs } from "@/features/operations/queries";
import { formatTimestamp } from "@/lib/format";
import { requireOperationsUser } from "@/lib/auth";

export const metadata = { title: "Gate overrides" };

export default async function OverridesPage() {
  await requireOperationsUser();
  const context = await getOfficeContext();
  if (!context.is_owner) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Pulse Operations" title="Gate overrides" description="Only the named owner can record or read gate overrides." />
      </div>
    );
  }

  const [jobs, overrides] = await Promise.all([listJobs(), listGateOverrides()]);

  return (
    <div className="space-y-8">
      <div>
        <PageHeader
          eyebrow="Pulse Operations"
          title="Gate overrides"
          description="A reason is required. The row cannot be edited afterwards. This does not change the job status by itself."
        />
      </div>
      <Card>
        <GateOverrideForm jobs={jobs} />
      </Card>
      <div>
        <h2 className="font-display text-2xl">Recorded</h2>
        {overrides.length === 0 ? (
          <p className="mt-3 text-ink/70">No overrides yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {overrides.map((row) => (
              <li key={row.id} className="rounded-3xl border border-line bg-card px-5 py-4">
                <p className="font-semibold">
                  {row.gate} · {row.job_label ?? row.entity_table}
                  {row.cin7_number ? ` · ${row.cin7_number}` : ""}
                </p>
                <p className="mt-2 text-sm leading-6 text-ink/80">{row.reason}</p>
                <p className="mt-2 text-xs text-grey">{formatTimestamp(row.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
