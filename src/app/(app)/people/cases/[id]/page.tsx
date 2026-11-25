import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/pulse/page-header";
import { PageSkeleton } from "@/components/pulse/states";
import { loadCase } from "@/features/hr/queries";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Case" };

export default function CasePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CaseFile params={params} />
    </Suspense>
  );
}

async function CaseFile({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireUser();
  const { id } = await params;
  const item = await loadCase(id);
  if (!item) notFound();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Jordan Pulse" title={item.title} />
      {item.due ? <p className="text-sm font-semibold">Decision due {item.due}</p> : null}
      <ol className="flex flex-wrap gap-2">
        {item.stages.map((stage) => (
          <li key={stage} className={`inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold ${stage.toLowerCase() === item.stage.toLowerCase() ? "bg-primary text-primary-foreground" : "border border-line"}`}>{stage}</li>
        ))}
      </ol>
      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <ol className="space-y-3">
          {item.entries.map((entry) => (
            <li key={entry.id} className="rounded-3xl border border-line bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-grey">{entry.kind} · {entry.when}</p>
              <p className="mt-2">{entry.body}</p>
            </li>
          ))}
        </ol>
        <aside className="rounded-3xl border border-line bg-card p-4">
          <h2 className="text-sm font-semibold">Members</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {item.members.map((member) => <li key={member} className="min-h-11">{member}</li>)}
          </ul>
        </aside>
      </div>
    </div>
  );
}
