"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useActionState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Banner, Button, Input, Select } from "@/components/pulse/ui";
import { EmptyState } from "@/components/pulse/states";
import { bulkUpdateSkuEffort, importSkuEffort } from "@/features/operations/effort-actions";
import type { SkuEffortRow } from "@/features/operations/queries";

const PAGE_SIZE = 50;

const COLUMNS = [
  ["sku", "SKU"],
  ["product_name", "Product"],
  ["cin7_category", "Cin7 category"],
  ["assembly", "Assembly"],
  ["unit", "Unit"],
  ["location", "Built at"],
  ["crew", "Crew"],
  ["minutes", "Minutes"],
  ["status", "Status"],
] as const;

type SortKey = (typeof COLUMNS)[number][0];

type Filters = { search: string; category: string; status: string; needsAssembly: string };

function assemblyLabel(value: boolean | null) {
  if (value == null) return "Unknown";
  return value ? "Yes" : "No";
}

function unitLabel(value: SkuEffortRow["effort_unit"]) {
  if (value === "m2") return "m²";
  if (value === "tile") return "Tile";
  return "Each";
}

function minutesLabel(row: SkuEffortRow) {
  if (row.build_location === "hq") return `HQ ${row.hq_build_minutes ?? "—"} / place ${row.site_position_minutes ?? "—"}`;
  return row.build_minutes == null ? "—" : String(row.build_minutes);
}

export function EffortDataTable({
  rows,
  page,
  total,
  filters,
  categories,
}: {
  rows: SkuEffortRow[];
  page: number;
  total: number;
  filters: Filters;
  categories: string[];
}) {
  const [sorting, setSorting] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [bulkState, bulkAction, bulkPending] = useActionState(bulkUpdateSkuEffort, null);
  const [imported, importCsv, importing] = useActionState(importSkuEffort, null);

  const visible = useMemo(() => {
    const copy = [...rows];
    if (!sorting) return copy;
    const { key, dir } = sorting;
    copy.sort((left, right) => {
      const compared = String(sortValue(left, key)).localeCompare(String(sortValue(right, key)), "en", { numeric: true });
      return dir === "asc" ? compared : -compared;
    });
    return copy;
  }, [rows, sorting]);
  const selectedSkus = visible.filter((row) => selected[row.sku]).map((row) => row.sku);
  const allChecked = visible.length > 0 && selectedSkus.length === visible.length;
  const someChecked = selectedSkus.length > 0 && !allChecked;
  const editingRow = rows.find((row) => row.sku === editing) ?? null;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const query = new URLSearchParams();
  if (filters.search) query.set("search", filters.search);
  if (filters.category) query.set("category", filters.category);
  if (filters.status) query.set("status", filters.status);
  if (filters.needsAssembly) query.set("needs", filters.needsAssembly);

  function hrefFor(nextPage: number) {
    const next = new URLSearchParams(query);
    next.set("page", String(nextPage));
    return `/operations/settings?${next.toString()}`;
  }

  function toggleAll(checked: boolean) {
    setSelected((current) => {
      const next = { ...current };
      for (const row of visible) next[row.sku] = checked;
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <form method="get" className="grid gap-3 rounded-2xl border border-border bg-muted/40 p-3 md:grid-cols-4">
        <label className="text-sm font-semibold md:col-span-2">
          <span className="mb-1 block text-muted-foreground">Search</span>
          <Input name="search" defaultValue={filters.search} placeholder="SKU or product" />
        </label>
        <label className="text-sm font-semibold">
          <span className="mb-1 block text-muted-foreground">Cin7 category</span>
          <Select name="category" searchable defaultValue={filters.category} aria-label="Cin7 category">
            <option value="">All categories</option>
            {categories.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </Select>
        </label>
        <label className="text-sm font-semibold">
          <span className="mb-1 block text-muted-foreground">Status</span>
          <Select name="status" defaultValue={filters.status} aria-label="Status">
            <option value="">All</option>
            <option value="suggested">Suggested</option>
            <option value="confirmed">Confirmed</option>
            <option value="name-rule">Name rule</option>
          </Select>
        </label>
        <label className="text-sm font-semibold">
          <span className="mb-1 block text-muted-foreground">Needs assembly</span>
          <Select name="needs" defaultValue={filters.needsAssembly} aria-label="Needs assembly">
            <option value="">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
            <option value="unknown">Unknown</option>
          </Select>
        </label>
        <div className="flex flex-wrap items-end gap-2 md:col-span-3">
          <Button type="submit" variant="secondary">Filter</Button>
          <Link href="/operations/settings" className="inline-flex min-h-11 items-center px-2 text-sm font-semibold underline decoration-primary">Clear</Link>
        </div>
      </form>

      <div className="flex flex-wrap items-end justify-between gap-3 text-sm">
        <a className="font-semibold text-foreground underline decoration-primary" href={`/api/orbit/effort-export?${query.toString()}`}>Export CSV</a>
        <form action={importCsv} className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-semibold">
            <span className="mb-1 block text-muted-foreground">Import CSV, keyed by SKU</span>
            <input name="csv" type="file" accept=".csv,text/csv" className="text-sm" />
          </label>
          <Button type="submit" variant="secondary" disabled={importing}>{importing ? "Importing..." : "Import"}</Button>
        </form>
      </div>
      {imported ? <Banner tone={imported.ok ? "success" : "error"}>{imported.message}</Banner> : null}

      <form action={bulkAction} className="space-y-3 rounded-2xl border border-border p-3">
        {selectedSkus.map((sku) => <input key={sku} type="hidden" name="sku" value={sku} />)}
        <p className="text-sm text-muted-foreground">{selectedSkus.length} selected on this page. Values below apply to the selection.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FieldSelect label="Needs install time" name="needsAssembly" defaultValue="">
            <option value="">Leave</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
            <option value="unknown">Unknown</option>
          </FieldSelect>
          <NumberField label="Crew" name="crew" max={6} />
          <NumberField label="Minutes" name="minutes" max={480} />
          <FieldSelect label="Unit" name="effortUnit" defaultValue="">
            <option value="">Leave</option>
            <option value="each">Each</option>
            <option value="tile">Tile</option>
            <option value="m2">m²</option>
          </FieldSelect>
          <FieldSelect label="Built at" name="buildLocation" defaultValue="">
            <option value="">Leave</option>
            <option value="site">Site</option>
            <option value="hq">HQ</option>
          </FieldSelect>
          <NumberField label="HQ minutes" name="hqMinutes" max={480} />
          <NumberField label="HQ crew" name="hqCrew" max={6} />
          <NumberField label="Placement minutes" name="placementMinutes" max={480} />
          <label className="text-sm font-semibold sm:col-span-2">
            <span className="mb-1 block text-muted-foreground">Notes</span>
            <Input name="notes" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" name="intent" value="apply" disabled={bulkPending || selectedSkus.length === 0}>Apply to selected</Button>
          <Button type="submit" name="intent" value="confirm" variant="secondary" disabled={bulkPending || selectedSkus.length === 0}>Confirm selected</Button>
        </div>
        {bulkState ? <Banner tone={bulkState.ok ? "success" : "error"}>{bulkState.message}</Banner> : null}
      </form>

      {visible.length === 0 ? (
        <EmptyState title="No products on this page" description="Sync from Cin7, or clear the filters." />
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {visible.map((row) => (
              <li key={row.sku} className="rounded-2xl border border-border bg-card p-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={Boolean(selected[row.sku])}
                    onCheckedChange={(checked) => setSelected((current) => ({ ...current, [row.sku]: checked }))}
                    aria-label={`Select ${row.sku}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs">{row.sku}</p>
                    <p className="font-semibold">{row.product_name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{row.cin7_category ?? "No category"} · {assemblyLabel(row.needs_assembly)} · {row.status}</p>
                    <p className="text-sm text-muted-foreground">{unitLabel(row.effort_unit)} · {row.build_location === "hq" ? "HQ" : "Site"} · crew {row.crew ?? "—"} · {minutesLabel(row)}</p>
                    <Button type="button" variant="ghost" className="mt-2 px-0" onClick={() => setEditing(row.sku)}>Edit row</Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden max-h-[70vh] overflow-auto rounded-2xl border border-border md:block">
            <table className="w-full min-w-[64rem] border-collapse text-sm">
              <caption className="sr-only">Effort table. Sorting applies to the rows on this page.</caption>
              <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_var(--border)]">
                <tr>
                  <th className="w-10 px-3 py-2 text-left">
                    <Checkbox
                      checked={allChecked}
                      indeterminate={someChecked}
                      onCheckedChange={(checked) => toggleAll(checked)}
                      aria-label="Select every row on this page"
                    />
                  </th>
                  {COLUMNS.map(([key, label]) => {
                    const sorted = sorting?.key === key ? sorting.dir : false;
                    return (
                      <th key={key} scope="col" aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"} className="px-3 py-2 text-left font-semibold text-muted-foreground">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                          onClick={() => setSorting((current) => current?.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" })}
                        >
                          {label}
                          {sorted === "asc" ? <ArrowUp className="size-3.5" /> : sorted === "desc" ? <ArrowDown className="size-3.5" /> : <ArrowUpDown className="size-3.5 opacity-50" />}
                        </button>
                      </th>
                    );
                  })}
                  <th scope="col" className="px-3 py-2 text-left font-semibold text-muted-foreground">Edit</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.sku} className="border-t border-border">
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={Boolean(selected[row.sku])}
                        onCheckedChange={(checked) => setSelected((current) => ({ ...current, [row.sku]: checked }))}
                        aria-label={`Select ${row.sku}`}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{row.sku}</td>
                    <td className="px-3 py-2">{row.product_name}</td>
                    <td className="px-3 py-2">
                      {row.cin7_category ?? "—"}
                      {row.suggestion_rule === "sled-track" ? <span className="mt-1 block text-xs text-muted-foreground">Name rule: sled track after flooring</span> : null}
                      {row.suggestion_rule === "pin-loaded" ? <span className="mt-1 block text-xs text-muted-foreground">Name rule: build at HQ</span> : null}
                    </td>
                    <td className="px-3 py-2">{assemblyLabel(row.needs_assembly)}</td>
                    <td className="px-3 py-2">
                      {unitLabel(row.effort_unit)}
                      {row.cin7_uom ? <span className="mt-1 block text-xs text-muted-foreground">Cin7 {row.cin7_uom}</span> : null}
                    </td>
                    <td className="px-3 py-2">{row.build_location === "hq" ? "HQ" : "Site"}</td>
                    <td className="px-3 py-2">{row.crew ?? "—"}</td>
                    <td className="px-3 py-2">{minutesLabel(row)}</td>
                    <td className="px-3 py-2">{row.status}</td>
                    <td className="px-3 py-2">
                      <Button type="button" variant="ghost" onClick={() => setEditing(row.sku)}>Edit</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editingRow ? <InlineEdit key={editingRow.sku} row={editingRow} onClose={() => setEditing(null)} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-muted-foreground">Page {page + 1} of {pageCount}. {total} products. Column sorting stays on this page.</p>
        <div className="flex gap-2">
          {page > 0 ? <Link className="inline-flex min-h-11 items-center rounded-full border border-border px-4 font-semibold" href={hrefFor(page - 1)}>Previous</Link> : null}
          {total > (page + 1) * PAGE_SIZE ? <Link className="inline-flex min-h-11 items-center rounded-full border border-border px-4 font-semibold" href={hrefFor(page + 1)}>Next</Link> : null}
        </div>
      </div>
    </div>
  );
}

function sortValue(row: SkuEffortRow, key: SortKey) {
  if (key === "sku") return row.sku;
  if (key === "product_name") return row.product_name;
  if (key === "cin7_category") return row.cin7_category ?? "";
  if (key === "assembly") return assemblyLabel(row.needs_assembly);
  if (key === "unit") return unitLabel(row.effort_unit);
  if (key === "location") return row.build_location === "hq" ? "HQ" : "Site";
  if (key === "crew") return row.crew ?? -1;
  if (key === "minutes") return row.build_minutes ?? row.hq_build_minutes ?? -1;
  return row.status;
}

function FieldSelect({ label, name, defaultValue, children }: { label: string; name: string; defaultValue: string; children: ReactNode }) {
  return (
    <label className="text-sm font-semibold">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      <Select name={name} defaultValue={defaultValue} aria-label={label}>{children}</Select>
    </label>
  );
}

function NumberField({ label, name, max }: { label: string; name: string; max: number }) {
  return (
    <label className="text-sm font-semibold">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      <Input name={name} type="number" min="0" max={max} />
    </label>
  );
}

function InlineEdit({ row, onClose }: { row: SkuEffortRow; onClose: () => void }) {
  const [state, action, pending] = useActionState(bulkUpdateSkuEffort, null);
  return (
    <form action={action} className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">Edit {row.sku}</p>
          <p className="text-sm text-muted-foreground">{row.product_name}</p>
        </div>
        <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      <input type="hidden" name="sku" value={row.sku} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FieldSelect label="Needs install time" name="needsAssembly" defaultValue={row.needs_assembly == null ? "unknown" : row.needs_assembly ? "yes" : "no"}>
          <option value="yes">Yes</option>
          <option value="no">No</option>
          <option value="unknown">Unknown</option>
        </FieldSelect>
        <label className="text-sm font-semibold">
          <span className="mb-1 block text-muted-foreground">Crew</span>
          <Input name="crew" type="number" min="1" max="6" defaultValue={row.crew ?? ""} />
        </label>
        <label className="text-sm font-semibold">
          <span className="mb-1 block text-muted-foreground">Minutes</span>
          <Input name="minutes" type="number" min="0" max="480" step="0.1" defaultValue={row.build_minutes ?? ""} />
        </label>
        <FieldSelect label="Unit" name="effortUnit" defaultValue={row.effort_unit === "tile" || row.effort_unit === "m2" ? row.effort_unit : "each"}>
          <option value="each">Each</option>
          <option value="tile">Tile</option>
          <option value="m2">m²</option>
        </FieldSelect>
        <FieldSelect label="Built at" name="buildLocation" defaultValue={row.build_location === "hq" ? "hq" : "site"}>
          <option value="site">Site</option>
          <option value="hq">HQ</option>
        </FieldSelect>
        <label className="text-sm font-semibold">
          <span className="mb-1 block text-muted-foreground">HQ minutes</span>
          <Input name="hqMinutes" type="number" min="0" max="480" defaultValue={row.hq_build_minutes ?? ""} />
        </label>
        <label className="text-sm font-semibold">
          <span className="mb-1 block text-muted-foreground">HQ crew</span>
          <Input name="hqCrew" type="number" min="1" max="6" defaultValue={row.hq_build_crew ?? ""} />
        </label>
        <label className="text-sm font-semibold">
          <span className="mb-1 block text-muted-foreground">Placement minutes</span>
          <Input name="placementMinutes" type="number" min="0" max="480" defaultValue={row.site_position_minutes ?? ""} />
        </label>
        <label className="text-sm font-semibold sm:col-span-2">
          <span className="mb-1 block text-muted-foreground">Notes</span>
          <Input name="notes" defaultValue={row.notes ?? ""} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="intent" value="apply" disabled={pending}>{pending ? "Saving..." : "Save row"}</Button>
        <Button type="submit" name="intent" value="confirm" variant="secondary" disabled={pending}>Save and confirm</Button>
      </div>
      {state ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
    </form>
  );
}
