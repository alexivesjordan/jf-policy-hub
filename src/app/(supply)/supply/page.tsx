import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState, PageSkeleton } from "@/components/pulse/states";
import { refreshSupplyNow } from "@/features/supply/refresh";
import { loadOverview, londonTime } from "@/features/supply/queries";

export const metadata = { title: "Supply" };

export default function SupplyPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  await connection();
  const pulse = await loadOverview();
  const tiles = [
    { label: "Zero stock", value: pulse.zeroStock, href: "/supply/skus" },
    { label: "Below reorder point", value: pulse.belowReorder, href: "/supply/reorder" },
    { label: "Overstock", value: pulse.overstock, href: "/supply/reorder" },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pulse Supply"
        title="Overview"
        actions={
          <form action={refreshSupplyNow}>
            <button className="inline-flex min-h-11 items-center rounded-full bg-red px-4 text-sm font-semibold text-white" type="submit">Refresh now</button>
          </form>
        }
      />
      <p className="text-sm text-grey">Last sync {londonTime(pulse.lastSync)}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <Link key={tile.label} href={tile.href} className="rounded-3xl border border-line bg-card px-4 py-4">
            <p className="text-sm text-grey">{tile.label}</p>
            <p className="font-mono text-3xl tabular-nums">{tile.value}</p>
          </Link>
        ))}
      </div>
      {pulse.alerts.length === 0 ? <EmptyState title="No stock alerts" /> : (
        <ul className="divide-y divide-line rounded-3xl border border-line bg-card">
          {pulse.alerts.map((alert) => (
            <li key={alert.sku}>
              <Link href={`/supply/skus/${encodeURIComponent(alert.sku)}`} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="font-semibold">{alert.sku}</span>
                <span className="text-grey">{alert.reason}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
