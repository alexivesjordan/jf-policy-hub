import { Suspense } from "react";
import { connection } from "next/server";
import { DecisionButtons } from "@/components/hr/decision-buttons";
import { LeaveRequestForm } from "@/components/hr/leave-request-form";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState, PageSkeleton } from "@/components/pulse/states";
import { loadHrHome } from "@/features/hr/queries";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Time off" };

export default function TimeOffPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TimeOff />
    </Suspense>
  );
}

async function TimeOff() {
  await connection();
  await requireUser();
  const home = await loadHrHome();
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <section className="rounded-3xl border border-line bg-card p-5">
        <h2 className="mb-4 font-display text-2xl">Request</h2>
        <LeaveRequestForm />
      </section>
      <section className="space-y-3">
        <PageHeader eyebrow="Jordan Pulse" title="Time off" />
        {home.pending.length === 0 ? <EmptyState title="No requests waiting" /> : home.pending.map((item) => (
          <p key={item.id} className="flex min-h-11 items-center justify-between rounded-2xl border border-line bg-card px-4">
            <span>{item.label}</span>
            <span className="text-sm">{item.status}</span>
          </p>
        ))}
        {home.manager ? (
          <div className="space-y-2 pt-4">
            <h2 className="font-display text-2xl">Approvals</h2>
            {home.mfaRequired ? <p className="text-sm font-semibold">Turn on two-step sign-in to open this.</p> : null}
            {!home.mfaRequired && home.waiting.length === 0 ? <EmptyState title="No requests waiting" /> : null}
            {home.waiting.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line px-4 py-2">
                <p className="font-semibold">{item.label}</p>
                <DecisionButtons id={item.id} kind={item.kind} />
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
