import { Suspense } from "react";
import { connection } from "next/server";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState, PageSkeleton } from "@/components/pulse/states";
import { saveSupplier } from "@/features/supply/actions";
import { loadSuppliers } from "@/features/supply/queries";

export const metadata = { title: "Suppliers" };

const field = "h-11 w-full rounded-2xl border border-line bg-field px-3 text-base";

export default function SuppliersPage() {
  return <Suspense fallback={<PageSkeleton />}><Suppliers /></Suspense>;
}

async function Suppliers() {
  await connection();
  const board = await loadSuppliers();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Pulse Supply" title="Suppliers" />
      {board.rows.length === 0 ? <EmptyState title="No suppliers" /> : (
        <ul className="grid gap-3">
          {board.rows.map((row) => (
            <li key={row.id} className="rounded-3xl border border-line bg-card p-4">
              <form action={saveSupplier} className="grid gap-3 sm:grid-cols-4">
                <input type="hidden" name="id" value={row.id} />
                <label className="text-sm font-semibold sm:col-span-2">Name<input name="name" defaultValue={row.name} disabled={!board.canEdit} className={field} /></label>
                <label className="text-sm font-semibold">Lead time<input name="leadTimeDays" type="number" min={0} defaultValue={row.leadTimeDays ?? ""} disabled={!board.canEdit} aria-label={`Lead time for ${row.name}`} className={field} /></label>
                <label className="text-sm font-semibold">Currency<input name="currency" defaultValue={row.currency} disabled={!board.canEdit} maxLength={3} className={field} /></label>
                <label className="text-sm font-semibold">MOQ<input name="moq" type="number" min={0} defaultValue={row.moq ?? ""} disabled={!board.canEdit} aria-label={`MOQ for ${row.name}`} className={field} /></label>
                <label className="text-sm font-semibold">Multiple<input name="orderMultiple" type="number" min={0} defaultValue={row.orderMultiple ?? ""} disabled={!board.canEdit} aria-label={`Order multiple for ${row.name}`} className={field} /></label>
                <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input name="active" type="checkbox" defaultChecked={row.active} disabled={!board.canEdit} /> Active</label>
                {board.canEdit ? <button className="inline-flex min-h-11 items-center justify-center rounded-full bg-red px-4 text-sm font-semibold text-white" type="submit">Save {row.name}</button> : null}
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
