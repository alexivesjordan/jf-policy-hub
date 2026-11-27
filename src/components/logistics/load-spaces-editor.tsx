"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Banner, Button, Field, Input, Select } from "@/components/pulse/ui";
import { saveLoadSpace, setLoadSpaceActive } from "@/features/logistics/packing/load-actions";
import type { PlannerSpace } from "@/features/logistics/packing/load-queries";
import { spaceCodeFromName } from "@/lib/packing/space-code";

type DraftSpace = {
  code: string;
  name: string;
  kind: "container" | "vehicle";
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  maxWeightKg: string;
  active: boolean;
};

function fromSpace(space: PlannerSpace): DraftSpace {
  return {
    code: space.code,
    name: space.name,
    kind: space.kind === "vehicle" ? "vehicle" : "container",
    lengthCm: String(space.lengthCm),
    widthCm: String(space.widthCm),
    heightCm: String(space.heightCm),
    maxWeightKg: String(space.maxWeightKg),
    active: space.active,
  };
}

export function LoadSpacesEditor({ spaces }: { spaces: PlannerSpace[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(() => spaces.map(fromSpace));
  const [creating, setCreating] = useState<DraftSpace>({ code: "", name: "", kind: "vehicle", lengthCm: "", widthCm: "", heightCm: "", maxWeightKg: "", active: true });
  const [codeTouched, setCodeTouched] = useState(false);
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(true);
  const [pending, setPending] = useState(false);

  function patch(code: string, next: Partial<DraftSpace>) {
    setRows((current) => current.map((row) => row.code === code ? { ...row, ...next } : row));
  }

  async function save(row: DraftSpace, isNew: boolean) {
    const label = row.name.trim() || row.code;
    if (!window.confirm(isNew ? `Add ${label}?` : `Save the dimensions for ${label}?`)) return;
    setPending(true);
    const result = await saveLoadSpace({ ...row, creating: isNew });
    setOk(result.ok);
    setMessage(result.message);
    setPending(false);
    if (result.ok) {
      if (isNew) {
        setRows((current) => [...current, { ...row, code: row.code.trim().toLowerCase(), name: row.name.trim() }]);
        setCreating({ code: "", name: "", kind: "vehicle", lengthCm: "", widthCm: "", heightCm: "", maxWeightKg: "", active: true });
        setCodeTouched(false);
      }
      router.refresh();
    }
  }

  async function toggle(row: DraftSpace) {
    const next = !row.active;
    if (!window.confirm(`${next ? "Activate" : "Deactivate"} ${row.name}?`)) return;
    setPending(true);
    const result = await setLoadSpaceActive(row.code, next);
    setOk(result.ok);
    setMessage(result.message);
    setPending(false);
    if (result.ok) {
      patch(row.code, { active: next });
      router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      {message ? <Banner tone={ok ? "success" : "error"}>{message}</Banner> : null}
      <section className="space-y-3 rounded-3xl border border-border bg-card p-4">
        <h2 className="font-display text-2xl">Add</h2>
        <SpaceFields
          row={creating}
          codeEditable
          onChange={(next) => {
            const code = next.code != null
              ? next.code
              : next.name != null && !codeTouched
                ? spaceCodeFromName(next.name)
                : creating.code;
            setCreating({ ...creating, ...next, code });
          }}
          onCode={() => setCodeTouched(true)}
        />
        <Button type="button" disabled={pending} onClick={() => void save(creating, true)}>Add</Button>
      </section>
      {rows.length === 0 ? <p className="text-sm">No containers or vehicles yet.</p> : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.code} className="space-y-3 rounded-3xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{row.code}</p>
                <p className="text-sm text-muted-foreground">{row.active ? "Active" : "Inactive"}</p>
              </div>
              <SpaceFields row={row} onChange={(next) => patch(row.code, next)} />
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={pending} onClick={() => void save(row, false)}>Save</Button>
                <Button type="button" variant="secondary" disabled={pending} onClick={() => void toggle(row)}>
                  {row.active ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SpaceFields({
  row,
  codeEditable,
  onChange,
  onCode,
}: {
  row: DraftSpace;
  codeEditable?: boolean;
  onChange: (next: Partial<DraftSpace>) => void;
  onCode?: () => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {codeEditable ? (
        <Field label="Code">
          <Input aria-label="Code" value={row.code} onChange={(event) => { onCode?.(); onChange({ code: event.target.value }); }} />
        </Field>
      ) : null}
      <Field label="Name">
        <Input aria-label={`Name ${row.code || "new"}`} value={row.name} onChange={(event) => onChange({ name: event.target.value })} />
      </Field>
      <Field label="Kind">
        <Select aria-label={`Kind ${row.code || "new"}`} value={row.kind} disabled={!codeEditable} onChange={(event) => onChange({ kind: event.target.value === "container" ? "container" : "vehicle" })}>
          <option value="vehicle">Vehicle</option>
          <option value="container">Container</option>
        </Select>
      </Field>
      <Field label="Length cm">
        <Input aria-label={`Length ${row.code || "new"}`} inputMode="numeric" value={row.lengthCm} onChange={(event) => onChange({ lengthCm: event.target.value })} />
      </Field>
      <Field label="Width cm">
        <Input aria-label={`Width ${row.code || "new"}`} inputMode="numeric" value={row.widthCm} onChange={(event) => onChange({ widthCm: event.target.value })} />
      </Field>
      <Field label="Height cm">
        <Input aria-label={`Height ${row.code || "new"}`} inputMode="numeric" value={row.heightCm} onChange={(event) => onChange({ heightCm: event.target.value })} />
      </Field>
      <Field label="Max cargo kg">
        <Input aria-label={`Max cargo ${row.code || "new"}`} inputMode="decimal" value={row.maxWeightKg} onChange={(event) => onChange({ maxWeightKg: event.target.value })} />
      </Field>
    </div>
  );
}
