import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState, PageSkeleton } from "@/components/pulse/states";
import { saveReorderQty } from "@/features/supply/actions";
import { loadReorder, type ReorderGroup } from "@/features/supply/queries";

export const metadata = { title: "Reorder" };

export default function ReorderPage() {
  return <Suspense fallback={<PageSkeleton />}><Reorder /></Suspense>;
}

async function Reorder() {
  await connection();
  const board = await loadReorder();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Pulse Supply" title="Reorder" />
      {board.groups.length === 0 ? <EmptyState title="No suggestions" /> : board.groups.map((group) => (
        <SupplierGroup key={group.supplierId ?? "none"} group={group} canEdit={board.canEdit} />
      ))}
    </div>
  );
}

function SupplierGroup({ group, canEdit }: { group: ReorderGroup; canEdit: boolean }) {
  const exportHref = `/api/supply/reorder/export?supplier=${encodeURIComponent(group.supplierId ?? "")}`;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{group.supplierName}</h2>
        <a className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold" href={exportHref}>CSV</a>
      </div>
      <div className="grid gap-3 md:hidden">
        {group.rows.map((row) => <QtyForm key={row.id} row={row} canEdit={canEdit} />)}
      </div>
      <div className="hidden overflow-hidden rounded-3xl border border-line md:block">
        <table className="w-full text-sm">
          <thead className="bg-card text-left text-grey">
            <tr>
              <th className="px-3 py-3 font-semibold">SKU</th>
              <th className="px-3 py-3 font-semibold">Available</th>
              <th className="px-3 py-3 font-semibold">On order</th>
              <th className="px-3 py-3 font-semibold">Reorder point</th>
              <th className="px-3 py-3 font-semibold">Qty</th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className="px-3 py-2"><Link className="font-semibold underline" href={`/supply/skus/${encodeURIComponent(row.sku)}`}>{row.sku}</Link></td>
                <td className="px-3 py-2 tabular-nums">{row.available}</td>
                <td className="px-3 py-2 tabular-nums">{row.onOrder}</td>
                <td className="px-3 py-2 tabular-nums">{row.reorderPoint}</td>
                <td className="px-3 py-2">{canEdit ? <QtyForm row={row} canEdit /> : row.suggestedQty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function QtyForm({ row, canEdit }: { row: ReorderGroup["rows"][number]; canEdit: boolean }) {
  return (
    <form action={saveReorderQty} className="flex items-center gap-2 rounded-2xl border border-line bg-card px-3 py-2 md:border-0 md:bg-transparent md:p-0">
      <input type="hidden" name="id" value={row.id} />
      <Link className="min-w-0 flex-1 font-semibold underline md:hidden" href={`/supply/skus/${encodeURIComponent(row.sku)}`}>{row.sku}</Link>
      <input name="qty" type="number" min={0} step={1} defaultValue={row.suggestedQty} aria-label={`Quantity for ${row.sku}`} disabled={!canEdit} className="h-11 w-24 rounded-2xl border border-line bg-field px-3 text-base tabular-nums" />
      {canEdit ? <button className="inline-flex min-h-11 items-center rounded-full border border-line px-3 text-sm font-semibold" type="submit">Save</button> : null}
    </form>
  );
}
