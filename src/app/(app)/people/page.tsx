import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { AllowanceRing } from "@/components/hr/allowance-ring";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState, PageSkeleton } from "@/components/pulse/states";
import { TextLink } from "@/components/pulse/ui";
import { loadHrHome } from "@/features/hr/queries";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "My HR" };

export default function PeoplePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Home />
    </Suspense>
  );
}

async function Home() {
  await connection();
  await requireUser();
  const home = await loadHrHome();
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Jordan Pulse" title="My HR" actions={<TextLink href="/people/time-off">Request time off</TextLink>} />
      <section className="rounded-3xl border border-line bg-card p-5">
        <AllowanceRing {...home.allowance} />
      </section>
      <div className="flex flex-wrap gap-2">
        <TextLink href="/people/sickness/new">Report sickness</TextLink>
        <TextLink href="/people/me" variant="ghost">My record</TextLink>
      </div>
      <section className="space-y-3">
        <h2 className="font-display text-2xl">My requests</h2>
        {home.pending.length === 0 ? <EmptyState title="No requests waiting" /> : (
          <ul className="space-y-2">
            {home.pending.map((item) => (
              <li key={item.id}>
                <Link href={item.href} className="flex min-h-11 items-center justify-between rounded-2xl border border-line bg-card px-4">
                  <span className="font-semibold">{item.label}</span>
                  <span className="text-sm text-grey">{item.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {home.manager ? (
        <section className="space-y-3">
          <h2 className="font-display text-2xl">Waiting for you</h2>
          {home.mfaRequired ? <p className="text-sm font-semibold">Turn on two-step sign-in to open this.</p> : null}
          {!home.mfaRequired && home.waiting.length === 0 ? <EmptyState title="No requests waiting" /> : null}
          <ul className="space-y-2">
            {home.waiting.map((item) => (
              <li key={item.id}>
                <Link href={item.href} className="flex min-h-11 items-center rounded-2xl border border-line bg-card px-4 font-semibold">{item.label}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
