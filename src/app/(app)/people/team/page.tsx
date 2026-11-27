import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState, PageSkeleton } from "@/components/pulse/states";
import { DecisionButtons } from "@/components/hr/decision-buttons";
import { TextLink } from "@/components/pulse/ui";
import { loadHrHome, loadTeam } from "@/features/hr/queries";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Team" };

export default function TeamPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Team />
    </Suspense>
  );
}

async function Team() {
  await connection();
  await requireUser();
  const [people, home] = await Promise.all([loadTeam(), loadHrHome()]);
  if (home.mfaRequired) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Jordan Pulse" title="Team" />
        <p className="text-sm font-semibold">Turn on two-step sign-in to open this.</p>
      </div>
    );
  }
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Jordan Pulse"
        title="Team"
        actions={home.checklistScope === "all" ? <TextLink href="/people/team/new">Add a joiner</TextLink> : null}
      />
      {people.length === 0 ? <EmptyState title="No one on your team" /> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {people.map((person) => (
            <li key={person.id}>
              <Link href={`/people/team/${person.id}`} className="flex min-h-11 items-center gap-3 rounded-3xl border border-line bg-card p-4">
                <span className="grid size-11 place-items-center rounded-full bg-mist text-sm font-semibold">{person.initials}</span>
                <span>
                  <span className="block font-semibold">{person.name}</span>
                  <span className="block text-sm text-grey">{person.role}</span>
                </span>
                <span className="ml-auto text-sm">{person.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <section className="space-y-3">
        <h2 className="font-display text-2xl">Approvals</h2>
        {home.waiting.length === 0 ? <EmptyState title="No requests waiting" /> : (
          <ul className="space-y-2">
            {home.waiting.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line px-4 py-2">
                <Link className="font-semibold" href={item.href}>{item.label}</Link>
                <DecisionButtons id={item.id} kind={item.kind} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
