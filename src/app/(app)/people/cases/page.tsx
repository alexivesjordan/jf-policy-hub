import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState, PageSkeleton } from "@/components/pulse/states";
import { TextLink } from "@/components/pulse/ui";
import { loadCases, loadHrHome } from "@/features/hr/queries";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Cases" };

export default function CasesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Cases />
    </Suspense>
  );
}

async function Cases() {
  await connection();
  await requireUser();
  const [cases, home] = await Promise.all([loadCases(), loadHrHome()]);
  if (home.mfaRequired) {
    return <p className="text-sm font-semibold">Turn on two-step sign-in to open this.</p>;
  }
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Jordan Pulse" title="Cases" actions={<TextLink href="/people/cases/new">Open a case</TextLink>} />
      {cases.length === 0 ? <EmptyState title="No cases" /> : (
        <ul className="space-y-2">
          {cases.map((item) => (
            <li key={item.id}>
              <Link href={`/people/cases/${item.id}`} className="flex min-h-11 items-center justify-between rounded-2xl border border-line bg-card px-4">
                <span className="font-semibold">{item.title}</span>
                <span className="text-sm text-grey">{item.stage}{item.due ? ` · ${item.due}` : ""}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
