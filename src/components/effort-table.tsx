"use client";

import { useActionState } from "react";
import { Banner, Button, Input, Select } from "@/components/pulse/ui";
import { EmptyState } from "@/components/pulse/states";
import { EffortDataTable } from "@/components/effort-data-table";
import {
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
      <CategoryTable
        rows={rows.map((row) => ({
          key: row.category,
          category: row.category,
          extra: row.status === "suggested" ? "suggested" : null,
          skuCount: null,
          assembly: row.needs_assembly == null ? "" : row.needs_assembly ? "yes" : "no",
          crew: row.crew ?? "",
          minutes: row.build_minutes ?? "",
          unit: row.effort_unit === "tile" || row.effort_unit === "m2" ? row.effort_unit : "each",
          location: row.build_location === "hq" ? "hq" : "site",
          hqMinutes: row.hq_build_minutes ?? "",
          hqCrew: row.hq_build_crew ?? "",
          placement: row.site_position_minutes ?? "",
          notes: row.notes ?? "",
          assemblyOptions: "known",
        }))}
      />
      <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Save category defaults"}</Button>
      {state ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
    </form>
  );
}

export function CategoryGapEditor({ rows }: { rows: CategoryGap[] }) {
  const [state, action, pending] = useActionState(saveMissingCategoryDefaults, null);
  if (rows.length === 0) return <EmptyState title="Every synced category has a default" description="New Cin7 categories will show up here after the next product sync." />;
  return (
    <form action={action} className="space-y-4">
      <CategoryTable
        rows={rows.map((row) => ({
          key: row.category,
          category: row.category,
          extra: null,
          skuCount: row.sku_count,
          assembly: "",
          crew: "",
          minutes: "",
          unit: "each",
          location: "site",
          hqMinutes: "",
          hqCrew: "",
          placement: "",
          notes: "",
          assemblyOptions: "gap",
        }))}
      />
      <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Save chosen defaults"}</Button>
      {state ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
    </form>
  );
}

type CategoryRow = {
  key: string;
  category: string;
  extra: string | null;
  skuCount: number | null;
  assembly: string;
  crew: string | number;
  minutes: string | number;
  unit: string;
  location: string;
  hqMinutes: string | number;
  hqCrew: string | number;
  placement: string | number;
  notes: string;
  assemblyOptions: "known" | "gap";
};

function CategoryTable({ rows }: { rows: CategoryRow[] }) {
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.key} className="rounded-2xl border border-border p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold">
              {row.category}
              <input type="hidden" name="category" value={row.category} />
            </p>
            <p className="text-xs text-muted-foreground">
              {row.skuCount == null ? row.extra : `${row.skuCount} SKUs`}
            </p>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm font-semibold">
              <span className="mb-1 block text-muted-foreground">Needs install time</span>
              <Select name="needsAssembly" defaultValue={row.assembly} aria-label={`Needs install time for ${row.category}`}>
                {row.assemblyOptions === "gap" ? <option value="">Leave unknown</option> : <option value="">Unknown</option>}
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </label>
            <label className="text-sm font-semibold">
              <span className="mb-1 block text-muted-foreground">Crew</span>
              <Input name="crew" type="number" min="1" max="6" defaultValue={row.crew} aria-label={`Crew for ${row.category}`} />
            </label>
            <label className="text-sm font-semibold">
              <span className="mb-1 block text-muted-foreground">Minutes</span>
              <Input name="minutes" type="number" min="0" max="480" step="0.1" defaultValue={row.minutes} aria-label={`Minutes for ${row.category}`} />
            </label>
            <label className="text-sm font-semibold">
              <span className="mb-1 block text-muted-foreground">Unit</span>
              <Select name="effortUnit" defaultValue={row.unit} aria-label={`Unit for ${row.category}`}>
                <option value="each">Each</option>
                <option value="tile">Tile</option>
                <option value="m2">m²</option>
              </Select>
            </label>
            <label className="text-sm font-semibold">
              <span className="mb-1 block text-muted-foreground">Built at</span>
              <Select name="buildLocation" defaultValue={row.location} aria-label={`Built at for ${row.category}`}>
                <option value="site">Site</option>
                <option value="hq">HQ</option>
              </Select>
            </label>
            <label className="text-sm font-semibold">
              <span className="mb-1 block text-muted-foreground">HQ minutes</span>
              <Input name="hqMinutes" type="number" min="0" max="480" defaultValue={row.hqMinutes} aria-label={`HQ minutes for ${row.category}`} />
            </label>
            <label className="text-sm font-semibold">
              <span className="mb-1 block text-muted-foreground">HQ crew</span>
              <Input name="hqCrew" type="number" min="1" max="6" defaultValue={row.hqCrew} aria-label={`HQ crew for ${row.category}`} />
            </label>
            <label className="text-sm font-semibold">
              <span className="mb-1 block text-muted-foreground">Placement</span>
              <Input name="placementMinutes" type="number" min="0" max="480" defaultValue={row.placement} aria-label={`Placement for ${row.category}`} />
            </label>
            <label className="text-sm font-semibold sm:col-span-2 lg:col-span-3">
              <span className="mb-1 block text-muted-foreground">Notes</span>
              <Input name="notes" defaultValue={row.notes} aria-label={`Notes for ${row.category}`} />
            </label>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SkuEffortEditor({
  rows,
  page,
  total,
  filters,
  categories,
}: {
  rows: SkuEffortRow[];
  page: number;
  total: number;
  filters: { search: string; category: string; status: string; needsAssembly: string };
  categories: string[];
}) {
  return <EffortDataTable rows={rows} page={page} total={total} filters={filters} categories={categories} />;
}
