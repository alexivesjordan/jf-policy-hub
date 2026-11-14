import { Suspense } from "react";
import { InstallArchiveList } from "@/components/install-archive-list";
import { PageHeader } from "@/components/pulse/page-header";
import { PageSkeleton } from "@/components/pulse/states";
import { listArchivedInstalls } from "@/features/sales/install-actions";
import { requireOperationsUser } from "@/lib/auth";
import { connection } from "next/server";

export const metadata = { title: "Archived installs" };

export default function OperationsArchivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Archive searchParams={searchParams} />
    </Suspense>
  );
}

async function Archive({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  await requireOperationsUser();
  const params = await searchParams;
  const raw = params.q;
  const query = (Array.isArray(raw) ? raw[0] : raw ?? "").trim();
  const listed = await listArchivedInstalls(query);
  const rows = (listed.installs ?? []).map((row) => ({
    id: String(row.id ?? ""),
    orderNumber: String(row.orderNumber ?? ""),
    customerName: String(row.customerName ?? ""),
    startOn: String(row.startOn ?? "").slice(0, 10),
    archivedAt: String(row.archivedAt ?? ""),
  })).filter((row) => row.id);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Pulse Operations" title="Archive" description="Completed installs leave the board a day after they are finished." />
      <InstallArchiveList basePath="/operations/installs" query={query} rows={rows} problem={listed.ok ? null : listed.message} />
    </div>
  );
}
