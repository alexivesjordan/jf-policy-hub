import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState, PageSkeleton } from "@/components/pulse/states";
import { loadSkus } from "@/features/supply/queries";
import { oneParam } from "@/lib/utils";

export const metadata = { title: "SKUs" };

export default function SkusPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Suspense fallback={<PageSkeleton />}><Skus searchParams={searchParams} /></Suspense>;
}

async function Skus({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const search = oneParam((await searchParams).q) ?? "";
  const rows = await loadSkus(search);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Pulse Supply" title="SKUs" />
      <form>
        <input name="q" defaultValue={search} aria-label="Search SKUs" placeholder="Search" className="h-11 w-full rounded-2xl border border-line bg-field px-3 text-base" />
      </form>
      {rows.length === 0 ? <EmptyState title="No SKUs" /> : (
        <ul className="divide-y divide-line rounded-3xl border border-line bg-card">
          {rows.map((row) => (
            <li key={row.sku}>
              <Link href={`/supply/skus/${encodeURIComponent(row.sku)}`} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2">
                <span className="min-w-0">
                  <span className="block font-semibold">{row.sku}</span>
                  {row.label ? <span className="block truncate text-sm text-grey">{row.label}</span> : null}
                </span>
                <span className="shrink-0 text-sm tabular-nums text-grey">{row.onHand ?? "—"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
