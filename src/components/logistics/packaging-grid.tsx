"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState, useTransition } from "react";
import { Banner, Button, Input, Select } from "@/components/pulse/ui";
import { addSkuPackage, deleteSkuPackage, importSkuPackages, saveSkuPackage, syncPackagingFromCin7 } from "@/features/logistics/packing/actions";
import type { SkuPackageRow } from "@/features/logistics/packing/row";

const PAGE_SIZE = 50;

export function PackagingTools({ exportHref }: { exportHref: string }) {
  const [syncState, syncAction, syncing] = useActionState(syncPackagingFromCin7, null);
  const [importState, importAction, importing] = useActionState(importSkuPackages, null);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <form action={syncAction}>
        <Button type="submit" disabled={syncing}>{syncing ? "Syncing" : "Sync products from Cin7"}</Button>
      </form>
      <a className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-semibold" href={exportHref}>Export CSV</a>
      <form action={importAction} className="flex flex-wrap items-end gap-2">
        <label className="text-sm font-semibold">
          CSV
          <input name="csv" type="file" accept=".csv,text/csv" aria-label="CSV" className="mt-1 block text-sm" />
        </label>
        <Button type="submit" variant="secondary" disabled={importing}>{importing ? "Importing" : "Import"}</Button>
      </form>
      {syncState ? <Banner tone={syncState.ok ? "success" : "error"}>{syncState.message}</Banner> : null}
      {importState ? <Banner tone={importState.ok ? "success" : "error"}>{importState.message}</Banner> : null}
    </div>
  );
}

export function PackagingGrid({
  rows,
  page,
  total,
  filters,
}: {
  rows: SkuPackageRow[];
  page: number;
  total: number;
  filters: { search: string; missing: boolean };
}) {
  const router = useRouter();
  const searchTimer = useRef<number | null>(null);
  const [search, setSearch] = useState(filters.search);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const query = new URLSearchParams();
  if (filters.search) query.set("search", filters.search);
  if (filters.missing) query.set("missing", "1");
  const seen = new Set<string>();

  function hrefFor(nextPage: number) {
    const next = new URLSearchParams(query);
    next.set("page", String(nextPage));
    return `/logistics/packaging?${next.toString()}`;
  }

  function pushFilters(next: { search?: string; missing?: boolean }) {
    const merged = { search, missing: filters.missing, ...next };
    const params = new URLSearchParams();
    if (merged.search) params.set("search", merged.search);
    if (merged.missing) params.set("missing", "1");
    const text = params.toString();
    router.replace(text ? `/logistics/packaging?${text}` : "/logistics/packaging");
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <label className="text-sm font-semibold">
          Search
          <Input
            value={search}
            aria-label="Search"
            className="mt-1"
            onChange={(event) => {
              const value = event.target.value;
              setSearch(value);
              if (searchTimer.current) window.clearTimeout(searchTimer.current);
              searchTimer.current = window.setTimeout(() => pushFilters({ search: value }), 300);
            }}
          />
        </label>
        <label className="text-sm font-semibold">
          Missing dimensions
          <Select className="mt-1" aria-label="Missing dimensions" value={filters.missing ? "missing" : ""} onChange={(event) => pushFilters({ missing: event.target.value === "missing" })}>
            <option value="">All</option>
            <option value="missing">Missing</option>
          </Select>
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-grey">
              <th className="px-2 py-2">SKU</th>
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2">Box</th>
              <th className="px-2 py-2">L (cm)</th>
              <th className="px-2 py-2">W (cm)</th>
              <th className="px-2 py-2">H (cm)</th>
              <th className="px-2 py-2">Weight (kg)</th>
              <th className="px-2 py-2">Stackable</th>
              <th className="px-2 py-2">Max stack</th>
              <th className="px-2 py-2">On side</th>
              <th className="px-2 py-2">Pallet only</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const lead = !seen.has(row.sku);
              seen.add(row.sku);
              return <PackageRow key={row.id} row={row} lead={lead} />;
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <p>No products.</p> : null}
      <div className="flex items-center justify-between text-sm">
        <p>Page {page + 1} of {pageCount}</p>
        <div className="flex gap-2">
          {page > 0 ? <Link className="font-semibold underline" href={hrefFor(page - 1)}>Previous</Link> : null}
          {total > (page + 1) * PAGE_SIZE ? <Link className="font-semibold underline" href={hrefFor(page + 1)}>Next</Link> : null}
        </div>
      </div>
    </div>
  );
}

function missing(row: SkuPackageRow) {
  return row.length_cm == null || row.width_cm == null || row.height_cm == null || row.gross_weight_kg == null;
}

function PackageRow({ row, lead }: { row: SkuPackageRow; lead: boolean }) {
  const router = useRouter();
  const [lengthCm, setLengthCm] = useState(row.length_cm == null ? "" : String(row.length_cm));
  const [widthCm, setWidthCm] = useState(row.width_cm == null ? "" : String(row.width_cm));
  const [heightCm, setHeightCm] = useState(row.height_cm == null ? "" : String(row.height_cm));
  const [weightKg, setWeightKg] = useState(row.gross_weight_kg == null ? "" : String(row.gross_weight_kg));
  const [stackable, setStackable] = useState(row.stackable ? "yes" : "no");
  const [maxStack, setMaxStack] = useState(row.max_stack == null ? "" : String(row.max_stack));
  const [onSide, setOnSide] = useState(row.can_be_on_side ? "yes" : "no");
  const [palletOnly, setPalletOnly] = useState(row.ships_on_pallet_only ? "yes" : "no");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function save() {
    setError("");
    start(async () => {
      const result = await saveSkuPackage({
        id: row.id,
        lengthCm,
        widthCm,
        heightCm,
        weightKg,
        stackable: stackable === "yes",
        maxStack,
        canBeOnSide: onSide === "yes",
        palletOnly: palletOnly === "yes",
      });
      if (!result?.ok) {
        setError(result?.message || "Could not save that package.");
        return;
      }
      router.refresh();
    });
  }

  function addBox() {
    setError("");
    start(async () => {
      const result = await addSkuPackage(row.sku);
      if (!result?.ok) {
        setError(result?.message || "Could not add a box.");
        return;
      }
      router.refresh();
    });
  }

  function remove() {
    setError("");
    start(async () => {
      const result = await deleteSkuPackage(row.id);
      if (!result?.ok) {
        setError(result?.message || "Could not remove that box.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <tr className="border-b border-line align-top">
      <td className="px-2 py-2 font-mono text-xs">{row.sku}</td>
      <td className="max-w-56 px-2 py-2">{row.product_name}</td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-2">
          <span>{row.package_no}</span>
          {missing(row) ? <span className="text-xs font-semibold">Missing</span> : null}
          {lead ? <button type="button" className="text-xs font-semibold underline" disabled={pending} onClick={addBox}>Add box</button> : null}
        </div>
      </td>
      <td className="px-2 py-2"><Input aria-label={`Length ${row.sku} ${row.package_no}`} inputMode="numeric" value={lengthCm} onChange={(event) => setLengthCm(event.target.value)} className="w-20" /></td>
      <td className="px-2 py-2"><Input aria-label={`Width ${row.sku} ${row.package_no}`} inputMode="numeric" value={widthCm} onChange={(event) => setWidthCm(event.target.value)} className="w-20" /></td>
      <td className="px-2 py-2"><Input aria-label={`Height ${row.sku} ${row.package_no}`} inputMode="numeric" value={heightCm} onChange={(event) => setHeightCm(event.target.value)} className="w-20" /></td>
      <td className="px-2 py-2"><Input aria-label={`Weight ${row.sku} ${row.package_no}`} inputMode="decimal" value={weightKg} onChange={(event) => setWeightKg(event.target.value)} className="w-20" /></td>
      <td className="px-2 py-2">
        <Select aria-label={`Stackable ${row.sku} ${row.package_no}`} value={stackable} onChange={(event) => setStackable(event.target.value)}>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </Select>
      </td>
      <td className="px-2 py-2"><Input aria-label={`Max stack ${row.sku} ${row.package_no}`} inputMode="numeric" value={maxStack} onChange={(event) => setMaxStack(event.target.value)} className="w-16" /></td>
      <td className="px-2 py-2">
        <Select aria-label={`On side ${row.sku} ${row.package_no}`} value={onSide} onChange={(event) => setOnSide(event.target.value)}>
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </Select>
      </td>
      <td className="px-2 py-2">
        <Select aria-label={`Pallet only ${row.sku} ${row.package_no}`} value={palletOnly} onChange={(event) => setPalletOnly(event.target.value)}>
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </Select>
      </td>
      <td className="px-2 py-2">
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending} onClick={save}>{pending ? "Saving" : "Save"}</Button>
          {row.package_no > 1 ? <Button type="button" variant="secondary" disabled={pending} onClick={remove}>Remove</Button> : null}
        </div>
        {error ? <p className="mt-1 text-xs" role="alert">{error}</p> : null}
      </td>
    </tr>
  );
}
