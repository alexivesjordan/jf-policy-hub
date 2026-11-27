"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { LoadDrawing } from "@/components/logistics/load-drawing";
import { EmptyState } from "@/components/pulse/states";
import { Banner, Button, Field, Input, Select, TextArea } from "@/components/pulse/ui";
import { packagesForLoad, parsePackingList, saveLoadPlan } from "@/features/logistics/packing/load-actions";
import type { OpenLoadPlan, PlannerSpace } from "@/features/logistics/packing/load-queries";
import {
  collectLoadLines,
  linesFromPackages,
  loadNoun,
  loadPlanCsv,
  planLoad,
  unplacedLabel,
  type LoadLine,
  type LoadPlanView,
} from "@/lib/packing/load-plan";
import { usableInterior } from "@/lib/packing/space";

type Draft = {
  key: string;
  sku: string;
  name: string;
  qty: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  weightKg: string;
  stackable: boolean;
  canBeOnSide: boolean;
  maxStack: number | null;
};

function draftFrom(line: LoadLine): Draft {
  return {
    key: line.id,
    sku: line.sku,
    name: line.name,
    qty: String(line.qty),
    lengthCm: String(line.lengthCm),
    widthCm: String(line.widthCm),
    heightCm: String(line.heightCm),
    weightKg: String(line.weightKg),
    stackable: line.stackable,
    canBeOnSide: line.canBeOnSide,
    maxStack: line.maxStack,
  };
}

function draftInput(lines: Draft[]) {
  return lines.map((line) => ({
    id: line.key,
    sku: line.sku,
    name: line.name,
    qty: line.qty,
    lengthCm: line.lengthCm,
    widthCm: line.widthCm,
    heightCm: line.heightCm,
    weightKg: line.weightKg,
    stackable: line.stackable,
    canBeOnSide: line.canBeOnSide,
    maxStack: line.maxStack,
  }));
}

export function LoadPlanner({
  spaces,
  open,
  missing,
}: {
  spaces: PlannerSpace[];
  open: OpenLoadPlan | null;
  missing: boolean;
}) {
  const router = useRouter();
  const [spaceCode, setSpaceCode] = useState(open?.spaceCode || spaces[0]?.code || "");
  const [name, setName] = useState(open?.name ?? "");
  const [reference, setReference] = useState(open?.reference ?? "");
  const [lines, setLines] = useState<Draft[]>(() => (open?.lines ?? []).map(draftFrom));
  const [plan, setPlan] = useState<LoadPlanView | null>(open?.summary ?? null);
  const [planId, setPlanId] = useState(open?.id ?? null);
  const [saleNumber, setSaleNumber] = useState("");
  const [sku, setSku] = useState("");
  const [qty, setQty] = useState("1");
  const [matches, setMatches] = useState<{ sku: string; name: string }[]>([]);
  const [manual, setManual] = useState({ name: "", sku: "", qty: "1", lengthCm: "", widthCm: "", heightCm: "", weightKg: "", stackable: true, canBeOnSide: false });
  const [csvText, setCsvText] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const searchTimer = useRef<number | null>(null);
  const space = spaces.find((item) => item.code === spaceCode) ?? spaces[0];

  function addDrafts(next: LoadLine[]) {
    setLines((current) => {
      const copy = [...current];
      for (const line of next) {
        const existing = copy.find((item) => item.key === line.id);
        if (existing) {
          const sum = Number(existing.qty || "0") + line.qty;
          existing.qty = String(Math.min(500, sum));
        } else {
          copy.push(draftFrom(line));
        }
      }
      return copy;
    });
    setPlan(null);
  }

  async function loadSale() {
    setWorking("sale");
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/logistics/pack-estimate/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: saleNumber }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Cin7 lookup failed.");
      const found = Array.isArray(json.lines) ? json.lines as { sku?: string; name?: string; qty?: number }[] : [];
      const order = typeof json.number === "string" ? json.number : saleNumber.trim();
      if (order) {
        setReference(order);
        setName((current) => current.trim() || order);
        setSaleNumber(order);
      }
      const skus = found.map((line) => line.sku?.trim() ?? "").filter(Boolean);
      const packed = await packagesForLoad(skus);
      if (!packed.ok) throw new Error(packed.message);
      const built = linesFromPackages(found.flatMap((line) => {
        const qtyValue = Number(line.qty);
        if (!line.sku?.trim() || !Number.isFinite(qtyValue)) return [];
        return [{ sku: line.sku.trim(), name: line.name?.trim() || line.sku.trim(), qty: qtyValue }];
      }), packed.packages);
      addDrafts(built.lines);
      if (built.problems.length) setError(built.problems.map((item) => item.message).join(" "));
      else if (!built.lines.length) setError("No goods lines.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cin7 lookup failed.");
    } finally {
      setWorking(null);
    }
  }

  function searchSku(value: string) {
    setSku(value);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(async () => {
      if (value.trim().length < 2) {
        setMatches([]);
        return;
      }
      const res = await fetch(`/api/logistics/packaging/search?q=${encodeURIComponent(value)}`);
      const json = await res.json().catch(() => null);
      setMatches(Array.isArray(json?.matches) ? json.matches : []);
    }, 300);
  }

  async function addSku(match?: { sku: string; name: string }) {
    const chosen = match ?? { sku: sku.trim(), name: sku.trim() };
    if (!chosen.sku) return;
    setWorking("sku");
    setError("");
    try {
      const packed = await packagesForLoad([chosen.sku]);
      if (!packed.ok) throw new Error(packed.message);
      const parsedQty = Number(qty);
      const built = linesFromPackages([{ sku: chosen.sku, name: chosen.name, qty: Number.isFinite(parsedQty) ? parsedQty : 1 }], packed.packages);
      addDrafts(built.lines);
      if (built.problems.length) setError(built.problems.map((item) => item.message).join(" "));
      setSku("");
      setMatches([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that SKU.");
    } finally {
      setWorking(null);
    }
  }

  function addManual() {
    const collected = collectLoadLines([{
      sku: manual.sku || manual.name,
      name: manual.name || manual.sku,
      qty: manual.qty,
      lengthCm: manual.lengthCm,
      widthCm: manual.widthCm,
      heightCm: manual.heightCm,
      weightKg: manual.weightKg,
      stackable: manual.stackable,
      canBeOnSide: manual.canBeOnSide,
    }]);
    if (collected.problems.length || !collected.lines.length) {
      setError(collected.problems[0]?.message ?? "Enter the box size and weight.");
      return;
    }
    const line = collected.lines[0]!;
    addDrafts([{ ...line, id: `box-${lines.length + 1}-${line.sku}` }]);
    setManual({ name: "", sku: "", qty: "1", lengthCm: "", widthCm: "", heightCm: "", weightKg: "", stackable: true, canBeOnSide: false });
    setError("");
  }

  async function addCsv(text: string) {
    setWorking("csv");
    setError("");
    try {
      const parsed = await parsePackingList(text);
      if (!parsed.ok) {
        setError(parsed.message);
        return;
      }
      addDrafts(parsed.lines);
      setCsvText("");
    } finally {
      setWorking(null);
    }
  }

  function runPlan() {
    if (!space) {
      setError("Choose a container or vehicle.");
      return;
    }
    const collected = collectLoadLines(draftInput(lines));
    const interior = usableInterior(space);
    const view = planLoad(collected.lines, interior, {
      code: space.code,
      name: space.name,
      kind: space.kind === "vehicle" ? "vehicle" : "container",
      lengthCm: interior.lengthCm,
      widthCm: interior.widthCm,
      heightCm: interior.heightCm,
      maxGoodsKg: interior.maxGoodsKg,
    });
    view.problems = [...collected.problems, ...view.problems];
    setPlan(view);
    setError("");
    setNotice("");
  }

  async function save() {
    if (!space) return;
    const label = name.trim() || reference.trim() || "Load plan";
    if (planId && !window.confirm(`Replace ${label}?`)) return;
    setWorking("save");
    setError("");
    try {
      const result = await saveLoadPlan({
        id: planId,
        name: label,
        spaceCode: space.code,
        reference,
        lines: draftInput(lines),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setNotice(result.message);
      setName(label);
      setPlanId(result.id);
      if (!planId) router.replace(`/logistics/load-plan?plan=${result.id}`);
      router.refresh();
    } finally {
      setWorking(null);
    }
  }

  function download() {
    if (!plan) return;
    const blob = new Blob([loadPlanCsv(plan)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(name.trim() || "load-plan").replace(/[^A-Za-z0-9-]+/g, "-")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function update(key: string, patch: Partial<Draft>) {
    setLines((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
    setPlan(null);
  }

  return (
    <div className="min-w-0 space-y-6">
      {missing ? <Banner tone="warning">That plan is not available.</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {notice ? <Banner tone="success">{notice}</Banner> : null}
      <div className="print:hidden space-y-4">
        <section className="grid gap-3 rounded-3xl border border-border bg-card p-4 sm:grid-cols-2">
          <Field label="Container or vehicle">
            <Select aria-label="Container or vehicle" value={spaceCode} onChange={(event) => { setSpaceCode(event.target.value); setPlan(null); }}>
              {spaces.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name} {item.lengthCm}×{item.widthCm}×{item.heightCm} cm
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Name">
            <Input aria-label="Name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Reference">
            <Input aria-label="Reference" value={reference} maxLength={200} onChange={(event) => setReference(event.target.value)} />
          </Field>
          <div className="flex flex-wrap items-end gap-2">
            <Button type="button" onClick={runPlan} disabled={working !== null}>Plan load</Button>
            <Button type="button" variant="secondary" onClick={() => void save()} disabled={working !== null || lines.length === 0}>
              {working === "save" ? "Saving" : "Save"}
            </Button>
          </div>
        </section>

        <section className="space-y-3 rounded-3xl border border-border bg-card p-4">
          <h2 className="font-display text-2xl">Sale</h2>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Order number">
              <Input aria-label="Order number" value={saleNumber} onChange={(event) => setSaleNumber(event.target.value)} />
            </Field>
            <Button type="button" variant="secondary" disabled={working !== null || !saleNumber.trim()} onClick={() => void loadSale()}>
              {working === "sale" ? "Loading" : "Add sale"}
            </Button>
          </div>
        </section>

        <section className="space-y-3 rounded-3xl border border-border bg-card p-4">
          <h2 className="font-display text-2xl">Catalogue</h2>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="SKU">
              <Input aria-label="SKU" value={sku} onChange={(event) => searchSku(event.target.value)} />
            </Field>
            <Field label="Qty">
              <Input aria-label="Catalogue quantity" inputMode="numeric" value={qty} onChange={(event) => setQty(event.target.value)} className="w-24" />
            </Field>
            <Button type="button" variant="secondary" disabled={working !== null || !sku.trim()} onClick={() => void addSku()}>Add SKU</Button>
          </div>
          {matches.length ? (
            <div className="flex flex-wrap gap-2">
              {matches.map((match) => (
                <button key={match.sku} type="button" className="min-h-11 rounded-full border border-border px-3 text-sm" onClick={() => void addSku(match)}>
                  {match.sku} {match.name}
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <section className="space-y-3 rounded-3xl border border-border bg-card p-4">
          <h2 className="font-display text-2xl">Box</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Name"><Input aria-label="Box name" value={manual.name} onChange={(event) => setManual({ ...manual, name: event.target.value })} /></Field>
            <Field label="SKU"><Input aria-label="Box SKU" value={manual.sku} onChange={(event) => setManual({ ...manual, sku: event.target.value })} /></Field>
            <Field label="Qty"><Input aria-label="Box quantity" inputMode="numeric" value={manual.qty} onChange={(event) => setManual({ ...manual, qty: event.target.value })} /></Field>
            <Field label="Length cm"><Input aria-label="Length cm" inputMode="numeric" value={manual.lengthCm} onChange={(event) => setManual({ ...manual, lengthCm: event.target.value })} /></Field>
            <Field label="Width cm"><Input aria-label="Width cm" inputMode="numeric" value={manual.widthCm} onChange={(event) => setManual({ ...manual, widthCm: event.target.value })} /></Field>
            <Field label="Height cm"><Input aria-label="Height cm" inputMode="numeric" value={manual.heightCm} onChange={(event) => setManual({ ...manual, heightCm: event.target.value })} /></Field>
            <Field label="Weight kg"><Input aria-label="Weight kg" inputMode="decimal" value={manual.weightKg} onChange={(event) => setManual({ ...manual, weightKg: event.target.value })} /></Field>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
              <input type="checkbox" className="size-5" checked={manual.stackable} onChange={(event) => setManual({ ...manual, stackable: event.target.checked })} />
              Stackable
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
              <input type="checkbox" className="size-5" checked={manual.canBeOnSide} onChange={(event) => setManual({ ...manual, canBeOnSide: event.target.checked })} />
              Can be on its side
            </label>
            <Button type="button" variant="secondary" onClick={addManual}>Add box</Button>
          </div>
        </section>

        <section className="space-y-3 rounded-3xl border border-border bg-card p-4">
          <h2 className="font-display text-2xl">Packing list</h2>
          <TextArea aria-label="Packing list" value={csvText} onChange={(event) => setCsvText(event.target.value)} placeholder={"sku,qty,L,W,H,kg\nRACK,1,140,120,210,160"} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" disabled={working !== null || !csvText.trim()} onClick={() => void addCsv(csvText)}>Add list</Button>
            <label className="text-sm font-semibold">
              CSV file
              <input
                aria-label="CSV file"
                type="file"
                accept=".csv,text/csv"
                className="mt-1 block min-h-11 text-sm"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  if (file.size > 1_000_000) {
                    setError("That CSV is larger than 1 MB.");
                    return;
                  }
                  void file.text().then((text) => addCsv(text));
                }}
              />
            </label>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-2xl">Items</h2>
          {lines.length === 0 ? <EmptyState title="Add items to plan a load." /> : (
            <ul className="space-y-3">
              {lines.map((line) => (
                <li key={line.key} className="grid gap-2 rounded-2xl border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-6">
                  <Field label="SKU"><Input aria-label={`SKU ${line.name}`} value={line.sku} onChange={(event) => update(line.key, { sku: event.target.value })} /></Field>
                  <Field label="Name"><Input aria-label={`Name ${line.sku || line.name}`} value={line.name} onChange={(event) => update(line.key, { name: event.target.value })} /></Field>
                  <Field label="Qty"><Input aria-label={`Qty ${line.sku || line.name}`} inputMode="numeric" value={line.qty} onChange={(event) => update(line.key, { qty: event.target.value })} /></Field>
                  <Field label="L cm"><Input aria-label={`Length ${line.sku || line.name}`} inputMode="numeric" value={line.lengthCm} onChange={(event) => update(line.key, { lengthCm: event.target.value })} /></Field>
                  <Field label="W cm"><Input aria-label={`Width ${line.sku || line.name}`} inputMode="numeric" value={line.widthCm} onChange={(event) => update(line.key, { widthCm: event.target.value })} /></Field>
                  <Field label="H cm"><Input aria-label={`Height ${line.sku || line.name}`} inputMode="numeric" value={line.heightCm} onChange={(event) => update(line.key, { heightCm: event.target.value })} /></Field>
                  <Field label="kg"><Input aria-label={`Weight ${line.sku || line.name}`} inputMode="decimal" value={line.weightKg} onChange={(event) => update(line.key, { weightKg: event.target.value })} /></Field>
                  <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" className="size-5" checked={line.stackable} onChange={(event) => update(line.key, { stackable: event.target.checked })} />
                    Stackable
                  </label>
                  <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" className="size-5" checked={line.canBeOnSide} onChange={(event) => update(line.key, { canBeOnSide: event.target.checked })} />
                    On side
                  </label>
                  <Button type="button" variant="secondary" onClick={() => { setLines(lines.filter((item) => item.key !== line.key)); setPlan(null); }}>Remove</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {plan ? <LoadResult plan={plan} onCsv={download} /> : null}
    </div>
  );
}

function LoadResult({ plan, onCsv }: { plan: LoadPlanView; onCsv: () => void }) {
  const noun = loadNoun(plan.space.kind, plan.containerCount);
  return (
    <section id="load-plan-print" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl">{plan.containerCount} {noun}</h2>
        <div className="print:hidden flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={onCsv}>Export CSV</Button>
          <Button type="button" variant="secondary" onClick={() => window.print()}>Print</Button>
        </div>
      </div>
      {plan.problems.map((problem) => <Banner key={problem.message} tone="warning">{problem.message}</Banner>)}
      {plan.containerCount === 0 && plan.unplaced.length === 0 ? <EmptyState title="Nothing placed." /> : null}
      {plan.bins.map((bin) => (
        <article key={bin.index} className="space-y-3 break-inside-avoid rounded-3xl border border-border bg-card p-4">
          <h3 className="font-display text-xl">{plan.space.name} {bin.index}</h3>
          <p className="text-sm">Volume {bin.volumePct}% · Weight {bin.weightPct}%</p>
          <p className="text-sm">{bin.freeVolumeM3} m³ and {bin.freeKg} kg free</p>
          {bin.roomFor ? (
            <p className="text-sm">Room for ~{bin.roomFor.atLeast ? `${bin.roomFor.count}+` : bin.roomFor.count} more of {bin.roomFor.sku}</p>
          ) : null}
          <LoadDrawing bin={bin} space={plan.space} noun={noun} />
          <h4 className="text-sm font-semibold">Loading list</h4>
          <ul className="space-y-2 md:hidden">
            {bin.loadOrder.map((stop) => (
              <li key={stop.order} className="rounded-2xl border border-border px-3 py-3 text-sm">
                <p className="font-semibold">{stop.order}. {stop.sku}</p>
                <p className="break-words">{stop.name}</p>
                <p>Back {stop.x} cm · Left {stop.y} cm · Floor {stop.z} cm</p>
                <p>{stop.lengthCm}×{stop.widthCm}×{stop.heightCm} cm · {stop.weightKg} kg</p>
              </li>
            ))}
          </ul>
          <table className="hidden w-full text-left text-sm md:table">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 pr-2 font-semibold">#</th>
                <th className="py-2 pr-2 font-semibold">SKU</th>
                <th className="py-2 pr-2 font-semibold">Name</th>
                <th className="py-2 pr-2 font-semibold">Back</th>
                <th className="py-2 pr-2 font-semibold">Left</th>
                <th className="py-2 pr-2 font-semibold">Floor</th>
                <th className="py-2 pr-2 font-semibold">cm</th>
                <th className="py-2 font-semibold">kg</th>
              </tr>
            </thead>
            <tbody>
              {bin.loadOrder.map((stop) => (
                <tr key={stop.order} className="border-b border-border">
                  <td className="py-2 pr-2">{stop.order}</td>
                  <td className="py-2 pr-2">{stop.sku}</td>
                  <td className="max-w-48 break-words py-2 pr-2">{stop.name}</td>
                  <td className="py-2 pr-2">{stop.x}</td>
                  <td className="py-2 pr-2">{stop.y}</td>
                  <td className="py-2 pr-2">{stop.z}</td>
                  <td className="py-2 pr-2">{stop.lengthCm}×{stop.widthCm}×{stop.heightCm}</td>
                  <td className="py-2">{stop.weightKg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      ))}
      {plan.unplaced.length ? (
        <div className="space-y-2">
          <h3 className="font-display text-xl">Unplaced</h3>
          <ul className="space-y-2">
            {plan.unplaced.map((item) => (
              <li key={`${item.sku}-${item.reason}`} className="rounded-2xl border border-border px-3 py-3 text-sm">
                <span className="font-semibold">{item.sku || item.name}</span> {unplacedLabel(item.reason)}{item.count > 1 ? ` (${item.count})` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
