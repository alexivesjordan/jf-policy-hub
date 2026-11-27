import { Suspense } from "react";
import { connection } from "next/server";
import { OrderPanel } from "@/components/tracker/order-panel";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/pulse/states";
import { Button, Field, Input } from "@/components/pulse/ui";
import { oneParam } from "@/lib/utils";
import { loadOrderTracking } from "@/lib/tracker/load";

export const instant = false;

export const metadata = { title: "Order tracking" };

export default function OrderTrackingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OrderTrackingScreen searchParams={searchParams} />
    </Suspense>
  );
}

async function OrderTrackingScreen({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const params = await searchParams;
  const query = (oneParam(params.q) ?? "").slice(0, 40);
  const result = await loadOrderTracking(query);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Sales" title="Order tracking" />
      <form action="/sales/orders" className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Order number">
          <Input name="q" defaultValue={query} autoComplete="off" className="sm:w-64" />
        </Field>
        <Button type="submit">Search</Button>
      </form>
      {result.state === "idle" ? <EmptyState title="Search an order number." /> : null}
      {result.state === "invalid" ? <ErrorState title="Enter an order number such as SO-00490." /> : null}
      {result.state === "offline" ? <ErrorState title="Cin7 is not connected." /> : null}
      {result.state === "missing" ? <EmptyState title="No order with that number." /> : null}
      {result.state === "error" ? <ErrorState title={result.message} /> : null}
      {result.state === "found" ? <OrderPanel snapshot={result.snapshot} links={result.links} /> : null}
    </div>
  );
}
