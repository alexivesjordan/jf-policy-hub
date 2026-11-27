import { Suspense } from "react";
import { connection } from "next/server";
import { JoinerForm } from "@/components/hr/joiner-form";
import { PageHeader } from "@/components/pulse/page-header";
import { PageSkeleton } from "@/components/pulse/states";
import { loadCanAddEngineer, loadHrHome, loadManagerOptions } from "@/features/hr/queries";
import { londonToday } from "@/lib/hr/checklists";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Add a joiner" };

export default function NewJoinerPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewJoiner />
    </Suspense>
  );
}

async function NewJoiner() {
  await connection();
  await requireUser();
  const home = await loadHrHome();
  if (home.checklistScope === "mfa") {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Jordan Pulse" title="Add a joiner" />
        <p className="text-sm font-semibold">Turn on two-step sign-in to open this.</p>
      </div>
    );
  }
  if (home.checklistScope !== "all") {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Jordan Pulse" title="Add a joiner" />
        <p className="text-sm font-semibold">You cannot add a joiner.</p>
      </div>
    );
  }
  const [managers, canAddEngineer] = await Promise.all([loadManagerOptions(), loadCanAddEngineer()]);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Jordan Pulse" title="Add a joiner" />
      <JoinerForm managers={managers} canAddEngineer={canAddEngineer} startDate={londonToday()} />
    </div>
  );
}
