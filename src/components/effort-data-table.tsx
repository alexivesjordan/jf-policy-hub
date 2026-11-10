"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useActionState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Upload } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  const [importOpen, setImportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const router = useRouter();
  const searchTimer = useRef<number | null>(null);

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

  function pushFilters(next: Partial<Filters>) {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams();
    if (merged.search) params.set("search", merged.search);
    if (merged.category) params.set("category", merged.category);
    if (merged.status) params.set("status", merged.status);
    if (merged.needsAssembly) params.set("needs", merged.needsAssembly);
    const queryText = params.toString();
    router.replace(queryText ? `/operations/settings?${queryText}` : "/operations/settings");
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-semibold sm:col-span-2">
            <span className="mb-1 block text-muted-foreground">Search</span>
            <Input
              name="search"
              defaultValue={filters.search}
              placeholder="SKU or product"
              aria-label="Search"
              onChange={(event) => {
                const value = event.target.value;
                if (searchTimer.current) window.clearTimeout(searchTimer.current);
                searchTimer.current = window.setTimeout(() => pushFilters({ search: value }), 250);
              }}
            />
          </label>
          <label className="text-sm font-semibold">
            <span className="mb-1 block text-muted-foreground">Category</span>
            <Select name="category" searchable defaultValue={filters.category} aria-label="Category" onChange={(event) => pushFilters({ category: event.target.value })}>
              <option value="">All categories</option>
              {categories.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </Select>
          </label>
          <label className="text-sm font-semibold">
            <span className="mb-1 block text-muted-foreground">Status</span>
            <Select name="status" defaultValue={filters.status} aria-label="Status" onChange={(event) => pushFilters({ status: event.target.value })}>
              <option value="">All</option>
              <option value="suggested">Suggested</option>
              <option value="confirmed">Confirmed</option>
              <option value="name-rule">Name rule</option>
            </Select>
          </label>
        </div>
        <div className="flex shrink-0 gap-2">
          <a className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-semibold" href={`/api/orbit/effort-export?${query.toString()}`}>Export CSV</a>
          <Button type="button" variant="secondary" onClick={() => setImportOpen(true)}>
            <Upload className="size-4" aria-hidden="true" />
            Import
          </Button>
        </div>
      </div>
      {imported ? <Banner tone={imported.ok ? "success" : "error"}>{imported.message}</Banner> : null}
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} action={importCsv} pending={importing} />

      {visible.length === 0 ? (
        <EmptyState title="No products on this page" description="Try a different search, or clear the filters." />
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

      {selectedSkus.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card px-4 py-3 shadow-lg">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold">{selectedSkus.length} selected</p>
            <div className="flex gap-2">
              <Button type="button" onClick={() => setEditOpen(true)}>Edit</Button>
              <Button type="button" variant="secondary" onClick={() => setSelected({})}>Clear</Button>
            </div>
          </div>
        </div>
      ) : null}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto bg-paper sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit {selectedSkus.length} selected</DialogTitle>
            <DialogDescription>Blank fields stay as they are. Confirm marks the rows as checked.</DialogDescription>
          </DialogHeader>
          <form action={bulkAction} className="grid gap-3 sm:grid-cols-2">
            {selectedSkus.map((sku) => <input key={sku} type="hidden" name="sku" value={sku} />)}
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
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" name="intent" value="apply" disabled={bulkPending}>Apply</Button>
              <Button type="submit" name="intent" value="confirm" variant="secondary" disabled={bulkPending}>Confirm</Button>
            </div>
            {bulkState ? <div className="sm:col-span-2"><Banner tone={bulkState.ok ? "success" : "error"}>{bulkState.message}</Banner></div> : null}
          </form>
        </DialogContent>
      </Dialog>

      <div className="flex flex-wrap items-center justify-between gap-3 pb-16 text-sm">
        <p className="text-muted-foreground">Page {page + 1} of {pageCount}. {total} products.</p>
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

const IMPORT_TEMPLATE = "sku,product_name,cin7_category,needs_assembly,crew,build_minutes,effort_unit,build_location,hq_build_minutes,hq_build_crew,site_position_minutes,status,notes\nJF-BENCH-01,Adjustable bench,Benches,yes,2,45,each,site,,,,confirmed,\n";

function previewCsv(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(","))
    .filter((row) => row.some((cell) => cell.trim()));
}

function ImportDialog({
  open,
  onOpenChange,
  action,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string[][]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");

  async function take(file: File | null) {
    setProblem(null);
    setFileName(file?.name ?? "");
    if (fileRef.current) {
      const transfer = new DataTransfer();
      if (file) transfer.items.add(file);
      fileRef.current.files = transfer.files;
    }
    if (!file) {
      setPreview([]);
      return;
    }
    const rows = previewCsv(await file.text());
    const header = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];
    if (!header.includes("sku")) {
      setProblem("The file needs a header row with a sku column.");
      setPreview([]);
      return;
    }
    setPreview(rows.slice(0, 6));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto bg-paper sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import effort</DialogTitle>
          <DialogDescription>Upload a CSV keyed by SKU. Nothing is saved until you apply it.</DialogDescription>
        </DialogHeader>
        <a className="text-sm font-semibold underline decoration-primary" download="effort-template.csv" href={`data:text/csv,${encodeURIComponent(IMPORT_TEMPLATE)}`}>
          Download template
        </a>
        <label
          className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-border px-4 py-6 text-center"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void take(event.dataTransfer.files[0] ?? null);
          }}
        >
          <Upload className="mb-2 size-5 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-semibold">{fileName || "Drop a CSV here, or choose a file"}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(event) => void take(event.target.files?.[0] ?? null)}
          />
        </label>
        {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
        {preview.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-xs">
              <tbody>
                {preview.map((row, index) => (
                  <tr key={index} className="border-t border-border first:border-t-0">
                    {row.slice(0, 4).map((cell, cellIndex) => (
                      <td key={cellIndex} className="px-2 py-1.5">{cell || "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-2 py-2 text-xs text-muted-foreground">First rows only. Apply saves every row in the file.</p>
          </div>
        ) : null}
        <form action={action}>
          <input ref={fileRef} name="csv" type="file" className="sr-only" tabIndex={-1} />
          <Button type="submit" disabled={pending || !fileName || Boolean(problem)}>{pending ? "Importing..." : "Apply import"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
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
