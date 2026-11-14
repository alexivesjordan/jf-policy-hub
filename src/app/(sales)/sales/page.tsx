import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { SalesRepFilter } from "@/components/sales-rep-filter";
import { PageHeader } from "@/components/pulse/page-header";
import { PageSkeleton } from "@/components/pulse/states";
import { loadSalesPulse } from "@/features/sales/pulse";
import { requireSalesUser } from "@/lib/auth";
import { salesPulseHref, type SalesPulseRow } from "@/lib/sales-pulse";
import { oneParam } from "@/lib/utils";

export const metadata = { title: "Sales" };

const ID = /^[0-9a-f-]{36}$/i;

export default function SalesHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SalesOverview searchParams={searchParams} />
    </Suspense>
  );
}

async function SalesOverview({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  await requireSalesUser();
  const params = await searchParams;
  const requested = oneParam(params.rep) ?? "";
  const pulse = await loadSalesPulse(ID.test(requested) ? requested : null);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pulse Sales"
        title="Overview"
        actions={pulse.admin ? <SalesRepFilter reps={pulse.reps} value={pulse.repId ?? ""} /> : null}
      />
      {pulse.error ? <p className="text-sm">{pulse.error}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Bucket title="Waiting to book" rows={pulse.waiting} />
        <Bucket title="Awaiting replies" rows={pulse.replies} />
        <Bucket title="Access forms" rows={pulse.access} />
        <Bucket title="This week" rows={pulse.week} />
      </div>
    </div>
  );
}

function Bucket({ title, rows }: { title: string; rows: SalesPulseRow[] }) {
  return (
    <section className="rounded-3xl border border-line bg-card px-4 py-4">
      <h2 className="flex items-baseline justify-between gap-3 text-sm font-semibold">
        {title}
        <span className="font-mono text-lg tabular-nums">{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-grey">None</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {rows.map((row) => (
            <li key={`${row.kind}-${row.id}`}>
              <Link href={salesPulseHref(row)} className="flex items-baseline justify-between gap-3 py-2 text-sm hover:underline">
                <span className="min-w-0 truncate">
                  <span className="font-semibold">{row.orderNumber}</span>
                  {row.customerName ? <span className="text-grey"> · {row.customerName}</span> : null}
                </span>
                {row.meta ? <span className="shrink-0 text-grey">{row.meta}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
