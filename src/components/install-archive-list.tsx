import Link from "next/link";
import { restoreArchivedInstall } from "@/features/sales/install-actions";
import { Button, Input } from "@/components/pulse/ui";
import { ukDate } from "@/components/install-sales-view";

export function InstallArchiveList({
  basePath,
  query,
  rows,
  problem,
}: {
  basePath: "/sales/installs" | "/operations/installs";
  query: string;
  rows: { id: string; orderNumber: string; customerName: string; startOn: string; archivedAt: string }[];
  problem: string | null;
}) {
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link className="font-semibold underline" href={basePath}>Back to installs</Link></p>
      {problem ? <p className="text-sm">{problem}</p> : null}
      <form className="flex flex-wrap items-center gap-2" action={`${basePath}/archive`}>
        <Input name="q" defaultValue={query} placeholder="SO number or customer" aria-label="Search archived installs" className="max-w-sm" />
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      {rows.length === 0 ? <p className="text-sm text-grey">No archived installs.</p> : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card px-4 py-3">
              <div>
                <p className="font-semibold">{row.customerName}</p>
                <p className="text-sm text-grey">{row.orderNumber} · {ukDate(row.startOn)}</p>
              </div>
              <form action={restoreArchivedInstall}>
                <input type="hidden" name="id" value={row.id} />
                <Button type="submit" variant="secondary">Restore</Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
