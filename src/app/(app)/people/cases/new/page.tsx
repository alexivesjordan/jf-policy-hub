import { Suspense } from "react";
import { connection } from "next/server";
import { OpenCaseForm } from "@/components/hr/open-case-form";
import { PageHeader } from "@/components/pulse/page-header";
import { PageSkeleton } from "@/components/pulse/states";
import { loadTeam } from "@/features/hr/queries";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Open a case" };

export default function OpenCasePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Open />
    </Suspense>
  );
}

async function Open() {
  await connection();
  await requireUser();
  const people = await loadTeam();
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Jordan Pulse" title="Open a case" />
      <OpenCaseForm people={people.map((person) => ({ id: person.id, name: person.name }))} />
    </div>
  );
}
