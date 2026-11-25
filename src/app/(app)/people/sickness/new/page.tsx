import { Suspense } from "react";
import { connection } from "next/server";
import { SicknessForm } from "@/components/hr/sickness-form";
import { PageHeader } from "@/components/pulse/page-header";
import { PageSkeleton } from "@/components/pulse/states";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Report sickness" };

export default function ReportSicknessPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Report />
    </Suspense>
  );
}

async function Report() {
  await connection();
  await requireUser();
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Jordan Pulse" title="Report sickness" />
      <SicknessForm />
    </div>
  );
}
