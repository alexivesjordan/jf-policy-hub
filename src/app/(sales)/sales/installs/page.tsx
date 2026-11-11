import { Suspense } from "react";
import { InstallCalendarPage } from "@/components/install-calendar";
import { PageSkeleton } from "@/components/pulse/states";

export const metadata = { title: "Installs" };

export default function SalesInstallsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <InstallCalendarPage
        basePath="/sales/installs"
        title="Installs"
        description="Every booked install. My installs shows only the ones you booked."
        searchParams={searchParams}
      />
    </Suspense>
  );
}
