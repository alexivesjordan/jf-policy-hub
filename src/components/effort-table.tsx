"use client";

import { useActionState } from "react";
import { Banner, Button, Input } from "@/components/ui";
import {
  bulkUpdateSkuEffort,
  importSkuEffort,
  saveCin7CategoryDefaults,
  saveMissingCategoryDefaults,
  syncProductsFromCin7,
} from "@/features/operations/effort-actions";
import type { CategoryGap, Cin7CategoryDefault, SkuEffortRow } from "@/features/operations/queries";

export function SyncProductsButton() {
  const [state, action, pending] = useActionState(syncProductsFromCin7, null);
  return (
    <form action={action} className="space-y-3">
      <Button type="submit" disabled={pending}>{pending ? "Syncing..." : "Sync products from Cin7"}</Button>
      {state ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
    </form>
  );
}

export function CategoryDefaultEditor({ rows }: { rows: Cin7CategoryDefault[] }) {
  const [state, action, pending] = useActionState(saveCin7CategoryDefaults, null);
  return (
    <form action={action} className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead>
            <tr className="text-left text-grey">
              <th className="py-2 pr-3">Cin7 category</th>
              <th className="py-2 pr-3">Needs assembly</th>
              <th className="py-2 pr-3">Crew</th>
              <th className="py-2 pr-3">Minutes</th>
              <th className="py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.category} className="border-t border-line">
                <td className="py-2 pr-3 font-semibold">
                  {row.category}
                  <input type="hidden" name="category" value={row.category} />
                  {row.status === "suggested" ? <span className="ml-2 text-xs font-normal text-grey">suggested</span> : null}
                </td>
                <td className="py-2 pr-3">
                  <select name="needsAssembly" defaultValue={row.needs_assembly == null ? "" : row.needs_assembly ? "yes" : "no"} className="min-h-11 rounded-2xl border border-line bg-paper px-3">
                    <option value="">Unknown</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </td>
                <td className="py-2 pr-3"><Input name="crew" type="number" min="1" max="6" defaultValue={row.crew ?? ""} /></td>
                <td className="py-2 pr-3"><Input name="minutes" type="number" min="0" max="480" defaultValue={row.build_minutes ?? ""} /></td>
                <td className="py-2"><Input name="notes" defaultValue={row.notes ?? ""} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Save category defaults"}</Button>
      {state ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
    </form>
  );
}

export function CategoryGapEditor({ rows }: { rows: CategoryGap[] }) {
  const [state, action, pending] = useActionState(saveMissingCategoryDefaults, null);
  if (rows.length === 0) return <p className="text-sm text-grey">Every synced category has a default.</p>;
  return (
    <form action={action} className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead>
            <tr className="text-left text-grey">
              <th className="py-2 pr-3">Cin7 category</th>
              <th className="py-2 pr-3">SKUs</th>
              <th className="py-2 pr-3">Needs assembly</th>
              <th className="py-2 pr-3">Crew</th>
              <th className="py-2 pr-3">Minutes</th>
              <th className="py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.category} className="border-t border-line">
                <td className="py-2 pr-3 font-semibold">
                  {row.category}
                  <input type="hidden" name="category" value={row.category} />
                </td>
                <td className="py-2 pr-3">{row.sku_count}</td>
                <td className="py-2 pr-3">
                  <select name="needsAssembly" defaultValue="" className="min-h-11 rounded-2xl border border-line bg-paper px-3">
                    <option value="">Leave unknown</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </td>
                <td className="py-2 pr-3"><Input name="crew" type="number" min="1" max="6" /></td>
                <td className="py-2 pr-3"><Input name="minutes" type="number" min="0" max="480" /></td>
                <td className="py-2"><Input name="notes" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Save chosen defaults"}</Button>
      {state ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
    </form>
  );
}

export function SkuEffortEditor({
  rows,
  page,
  filters,
}: {
  rows: SkuEffortRow[];
  page: number;
  filters: { search: string; category: string; status: string; needsAssembly: string };
}) {
  const [state, action, pending] = useActionState(bulkUpdateSkuEffort, null);
  const [imported, importCsv, importing] = useActionState(importSkuEffort, null);
  const query = new URLSearchParams();
  if (filters.search) query.set("search", filters.search);
  if (filters.category) query.set("category", filters.category);
  if (filters.status) query.set("status", filters.status);
  if (filters.needsAssembly) query.set("needs", filters.needsAssembly);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 text-sm">
        <a className="font-semibold text-ink underline decoration-red" href={`/api/orbit/effort-export?${query.toString()}`}>Export CSV</a>
      </div>
      <form action={importCsv} className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-grey">Import CSV, keyed by SKU</span>
          <input name="csv" type="file" accept=".csv,text/csv" className="text-sm" />
        </label>
        <Button type="submit" variant="secondary" disabled={importing}>{importing ? "Importing..." : "Import"}</Button>
      </form>
      {imported ? <Banner tone={imported.ok ? "success" : "error"}>{imported.message}</Banner> : null}
      <form action={action} className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-grey">Needs assembly</span>
            <select name="needsAssembly" defaultValue="" className="min-h-11 rounded-2xl border border-line bg-paper px-3">
              <option value="">Leave</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-grey">Crew</span>
            <Input name="crew" type="number" min="1" max="6" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-grey">Minutes</span>
            <Input name="minutes" type="number" min="0" max="480" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-grey">Notes</span>
            <Input name="notes" />
          </label>
          <Button type="submit" name="intent" value="apply" disabled={pending}>Apply to selected</Button>
          <Button type="submit" name="intent" value="confirm" variant="secondary" disabled={pending}>Confirm selected</Button>
        </div>
        {state ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] border-collapse text-sm">
            <thead>
              <tr className="text-left text-grey">
                <th className="py-2 pr-3"> </th>
                <th className="py-2 pr-3">SKU</th>
                <th className="py-2 pr-3">Product</th>
                <th className="py-2 pr-3">Cin7 category</th>
                <th className="py-2 pr-3">Assembly</th>
                <th className="py-2 pr-3">Crew</th>
                <th className="py-2 pr-3">Minutes</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.sku} className="border-t border-line">
                  <td className="py-2 pr-3"><input type="checkbox" name="sku" value={row.sku} aria-label={`Select ${row.sku}`} /></td>
                  <td className="py-2 pr-3 font-mono text-xs">{row.sku}</td>
                  <td className="py-2 pr-3">{row.product_name}</td>
                  <td className="py-2 pr-3">{row.cin7_category ?? "—"}</td>
                  <td className="py-2 pr-3">{row.needs_assembly == null ? "Unknown" : row.needs_assembly ? "Yes" : "No"}</td>
                  <td className="py-2 pr-3">{row.crew ?? "—"}</td>
                  <td className="py-2 pr-3">{row.build_minutes ?? "—"}</td>
                  <td className="py-2">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? <p className="text-sm text-grey">No products on this page. Sync from Cin7, or clear the filters.</p> : null}
      </form>
      <p className="text-sm text-grey">Page {page + 1}. Fifty rows at a time.</p>
    </div>
  );
}
