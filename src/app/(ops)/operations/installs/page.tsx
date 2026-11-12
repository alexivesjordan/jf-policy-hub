import { Suspense } from "react";
import { InstallCalendarPage } from "@/components/install-calendar";
import { PageSkeleton } from "@/components/pulse/states";
import { requireOperationsUser } from "@/lib/auth";

export const metadata = { title: "Installs" };

export default function OperationsInstallsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OpsInstalls searchParams={searchParams} />
    </Suspense>
  );
}

async function OpsInstalls({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperationsUser();
  return (
    <InstallCalendarPage
      basePath="/operations/installs"
      title="Installs"
      searchParams={searchParams}
    />
  );
}
