import { Suspense } from "react";
import { connection } from "next/server";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState, PageSkeleton } from "@/components/pulse/states";
import { deleteMapping, removeBatch, saveAlias, saveMapping } from "@/features/supply/actions";
import { loadMappings, londonTime } from "@/features/supply/queries";
import { ConfirmButton } from "./confirm-button";
import { ImportWorkbench } from "./workbench";

export const metadata = { title: "Import" };

const field = "h-11 w-full rounded-2xl border border-line bg-field px-3 text-base";

export default function ImportPage() {
  return <Suspense fallback={<PageSkeleton />}><Import /></Suspense>;
}

async function Import() {
  await connection();
  const board = await loadMappings();
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Pulse Supply" title="Import" />
      {board.mappings.length === 0 ? <EmptyState title="No mappings" /> : <ImportWorkbench mappings={board.mappings} />}
      <ul className="grid gap-3">
        {board.batches.map((batch) => (
          <li key={batch.id} className="rounded-3xl border border-line bg-card p-4 text-sm">
            <p className="font-semibold">{batch.mappingName ?? batch.filePath ?? "Batch"}</p>
            <p className="text-grey">{batch.status} · {batch.rowsRead} read · {batch.rowsLoaded} loaded · {batch.rowsUnmatched} unmatched · {londonTime(batch.createdAt)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a className="inline-flex min-h-11 items-center rounded-full border border-line px-4 font-semibold" href={`/api/supply/import/unmatched?batch=${batch.id}`}>Unmatched CSV</a>
              {board.canEdit ? <ConfirmButton label="Remove batch" confirm={`Remove batch ${batch.mappingName ?? batch.filePath ?? batch.id}?`} action={removeBatch} id={batch.id} /> : null}
            </div>
          </li>
        ))}
      </ul>
      {board.canEdit ? (
        <form action={saveMapping} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold sm:col-span-2">Mapping name<input name="mappingName" className={field} /></label>
          <label className="text-sm font-semibold">Kind
            <select name="kind" className={field}>
              <option value="sales_lines">Sales lines</option>
              <option value="purchase_lines">Purchase lines</option>
              <option value="suppliers">Suppliers</option>
            </select>
          </label>
          <label className="text-sm font-semibold">Date format
            <select name="dateFormat" defaultValue="dd/mm/yyyy" className={field}>
              <option value="dd/mm/yyyy">dd/mm/yyyy</option>
              <option value="dd/mm/yy">dd/mm/yy</option>
              <option value="yyyy-mm-dd">yyyy-mm-dd</option>
            </select>
          </label>
          <label className="text-sm font-semibold">Date column<input name="date" className={field} /></label>
          <label className="text-sm font-semibold">SKU column<input name="sku" className={field} /></label>
          <label className="text-sm font-semibold">Qty column<input name="qty" className={field} /></label>
          <label className="text-sm font-semibold">Customer or supplier<input name="party" className={field} /></label>
          <label className="text-sm font-semibold">PO ref<input name="poRef" className={field} /></label>
          <label className="text-sm font-semibold">Ordered<input name="orderedOn" className={field} /></label>
          <label className="text-sm font-semibold">Received<input name="receivedOn" className={field} /></label>
          <button className="inline-flex min-h-11 items-center justify-center rounded-full bg-red px-4 text-sm font-semibold text-white sm:col-span-2" type="submit">Save mapping</button>
        </form>
      ) : null}
      {board.canAdmin ? (
        <ul className="grid gap-2">
          {board.mappings.map((mapping) => (
            <li key={mapping.id}><ConfirmButton label="Delete mapping" confirm={`Delete mapping ${mapping.name}?`} action={deleteMapping} id={mapping.id} /></li>
          ))}
        </ul>
      ) : null}
      {board.canEdit ? (
        <form action={saveAlias} className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-semibold">External code<input name="code" className={field} /></label>
          <label className="text-sm font-semibold">SKU<input name="sku" className={field} /></label>
          <button className="inline-flex min-h-11 items-center justify-center rounded-full border border-line px-4 text-sm font-semibold" type="submit">Save alias</button>
        </form>
      ) : null}
    </div>
  );
}
