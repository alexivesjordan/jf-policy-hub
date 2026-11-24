"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button, Input, Select } from "@/components/pulse/ui";
import { saveSkuEffortRow } from "@/features/operations/effort-actions";
import type { SkuEffortRow } from "@/features/operations/queries";

const PAGE_SIZE = 50;

type Filters = { search: string; category: string; status: string; needsAssembly: string };

function classLabel(value: SkuEffortRow["effort_class"]) {
  if (value === "delivery_only") return "Delivery only";
  if (value === "rack") return "Rack";
  if (value === "needs_build") return "Needs build";
  if (value === "unsure") return "Unsure";
  return "—";
}

function assemblyValue(value: boolean | null): "yes" | "no" | "unknown" {
  if (value == null) return "unknown";
  return value ? "yes" : "no";
}

export function SkuEffortGrid({
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
  const router = useRouter();
  const searchTimer = useRef<number | null>(null);
  const [search, setSearch] = useState(filters.search);
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
    const merged = { ...filters, search, ...next };
    const params = new URLSearchParams();
    if (merged.search) params.set("search", merged.search);
    if (merged.category) params.set("category", merged.category);
    if (merged.status) params.set("status", merged.status);
    if (merged.needsAssembly) params.set("needs", merged.needsAssembly);
    const text = params.toString();
    router.replace(text ? `/operations/settings?${text}` : "/operations/settings");
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem_12rem]">
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
          Category
          <Select className="mt-1" aria-label="Category" value={filters.category} onChange={(event) => pushFilters({ category: event.target.value })}>
            <option value="">All</option>
            {categories.map((name) => <option key={name} value={name}>{name}</option>)}
          </Select>
        </label>
        <label className="text-sm font-semibold">
          Status
          <Select className="mt-1" aria-label="Status" value={filters.status} onChange={(event) => pushFilters({ status: event.target.value })}>
            <option value="">All</option>
            <option value="no-build-time">No build time</option>
            <option value="suggested">Suggested</option>
            <option value="confirmed">Confirmed</option>
          </Select>
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-grey">
              <th className="px-2 py-2">SKU</th>
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2">Category</th>
              <th className="px-2 py-2">Class</th>
              <th className="px-2 py-2">Rack family</th>
              <th className="px-2 py-2">Needs assembly</th>
              <th className="px-2 py-2">Crew</th>
              <th className="px-2 py-2">Build minutes</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => <SkuRow key={row.sku} row={row} />)}
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

function SkuRow({ row }: { row: SkuEffortRow }) {
  const router = useRouter();
  const [assembly, setAssembly] = useState(assemblyValue(row.needs_assembly));
  const [crew, setCrew] = useState(row.crew == null ? "" : String(row.crew));
  const [minutes, setMinutes] = useState(row.build_minutes == null ? "" : String(row.build_minutes));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function save() {
    setError("");
    start(async () => {
      const result = await saveSkuEffortRow({
        sku: row.sku,
        needsAssembly: assembly,
        crew: crew === "" ? null : Number(crew),
        minutes: minutes === "" ? null : Number(minutes),
      });
      if (!result?.ok) {
        setError(result?.message || "Could not save that SKU.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <tr className="border-b border-line">
      <td className="px-2 py-2 font-mono text-xs">{row.sku}</td>
      <td className="px-2 py-2">{row.product_name}</td>
      <td className="px-2 py-2">{row.cin7_category ?? "—"}</td>
      <td className="px-2 py-2">{classLabel(row.effort_class)}</td>
      <td className="px-2 py-2">{row.rack_family ?? "—"}</td>
      <td className="px-2 py-2">
        <Select aria-label={`Needs assembly ${row.sku}`} value={assembly} onChange={(event) => setAssembly(event.target.value as "yes" | "no" | "unknown")}>
          <option value="unknown">Unknown</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </Select>
      </td>
      <td className="px-2 py-2">
        <Input aria-label={`Crew ${row.sku}`} inputMode="numeric" value={crew} onChange={(event) => setCrew(event.target.value)} className="w-16" />
      </td>
      <td className="px-2 py-2">
        <Input aria-label={`Build minutes ${row.sku}`} inputMode="decimal" value={minutes} onChange={(event) => setMinutes(event.target.value)} className="w-20" />
      </td>
      <td className="px-2 py-2">{row.status === "confirmed" ? "Confirmed" : "Suggested"}</td>
      <td className="px-2 py-2">
        <Button type="button" disabled={pending} onClick={save}>{pending ? "Saving" : "Save"}</Button>
        {error ? <p className="mt-1 text-xs">{error}</p> : null}
      </td>
    </tr>
  );
}
