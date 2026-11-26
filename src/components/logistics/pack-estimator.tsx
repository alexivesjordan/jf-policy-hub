"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { PalletLayout } from "@/components/logistics/pallet-layout";
import { Banner, Button, Input, Select } from "@/components/pulse/ui";
import { savePackingDefaults } from "@/features/logistics/packing/actions";
import type { EstimateResult, LoadSpace } from "@/lib/packing/types";

type Line = { key: string; sku: string; name: string; qty: string };
type Match = { sku: string; name: string };

export function PackEstimator({
  pallets,
  defaults,
}: {
  pallets: (LoadSpace & { name: string })[];
  defaults: {
    palletCode: string;
    maxHeightCm: number;
    maxWeightKg: number;
    maxParcelWeightKg: number;
    maxParcelLengthCm: number;
  };
}) {
  const [number, setNumber] = useState("");
  const [customer, setCustomer] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [sku, setSku] = useState("");
  const [qty, setQty] = useState("1");
  const [matches, setMatches] = useState<Match[]>([]);
  const [palletCode, setPalletCode] = useState(defaults.palletCode || pallets[0]?.code || "");
  const [maxHeightCm, setMaxHeightCm] = useState(String(defaults.maxHeightCm));
  const [maxWeightKg, setMaxWeightKg] = useState(String(defaults.maxWeightKg));
  const [maxParcelWeightKg, setMaxParcelWeightKg] = useState(String(defaults.maxParcelWeightKg));
  const [maxParcelLengthCm, setMaxParcelLengthCm] = useState(String(defaults.maxParcelLengthCm));
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState<"lookup" | "estimate" | "save" | "defaults" | null>(null);
  const router = useRouter();
  const searchTimer = useRef<number | null>(null);

  function settingsBody() {
    return {
      palletCode,
      maxHeightCm: Number(maxHeightCm),
      maxWeightKg: Number(maxWeightKg),
      maxParcelWeightKg: Number(maxParcelWeightKg),
      maxParcelLengthCm: Number(maxParcelLengthCm),
    };
  }

  function payload() {
    return {
      ...settingsBody(),
      orderNumbers: number.trim(),
      lines: lines.flatMap((line) => {
        const parsed = Number(line.qty);
        if (!line.sku.trim() || !Number.isFinite(parsed) || parsed <= 0) return [];
        return [{ sku: line.sku.trim(), name: line.name, qty: parsed }];
      }),
    };
  }

  async function lookup() {
    setWorking("lookup");
    setError("");
    setNotice("");
    setEstimate(null);
    try {
      const res = await fetch("/api/logistics/pack-estimate/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Cin7 lookup failed.");
      const found = Array.isArray(json.lines) ? json.lines as { sku?: string; name?: string; qty?: number }[] : [];
      setCustomer(typeof json.customerName === "string" ? json.customerName : "");
      setNumber(typeof json.number === "string" ? json.number : number);
      setLines(found.map((line, index) => ({
        key: `${line.sku ?? "line"}-${index}`,
        sku: line.sku ?? "",
        name: line.name ?? line.sku ?? "Item",
        qty: String(line.qty ?? 1),
      })));
      if (!found.length) setError("No goods lines.");
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

  function addLine(match?: Match) {
    const chosen = match ?? matches.find((item) => item.sku.toLowerCase() === sku.trim().toLowerCase()) ?? { sku: sku.trim(), name: sku.trim() };
    if (!chosen.sku) return;
    setLines((current) => {
      const existing = current.find((line) => line.sku === chosen.sku);
      if (existing) {
        return current.map((line) => line.key === existing.key ? { ...line, qty: String(Number(line.qty || "0") + Number(qty || "1")) } : line);
      }
      return [...current, { key: `${chosen.sku}-${current.length}`, sku: chosen.sku, name: chosen.name, qty: qty || "1" }];
    });
    setSku("");
    setMatches([]);
    setEstimate(null);
  }

  async function estimateShipment() {
    setWorking("estimate");
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/logistics/pack-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not estimate that shipment.");
      setEstimate(json.estimate as EstimateResult);
    } catch (err) {
      setEstimate(null);
      setError(err instanceof Error ? err.message : "Could not estimate that shipment.");
    } finally {
      setWorking(null);
    }
  }

  async function sendToInvoice() {
    setWorking("save");
    setError("");
    try {
      const res = await fetch("/api/logistics/pack-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload(), save: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not save that estimate.");
      router.push(`/logistics/commercial-invoices?pack=${json.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that estimate.");
      setWorking(null);
    }
  }

  async function saveDefaults() {
    setWorking("defaults");
    setNotice("");
    setError("");
    const settings = settingsBody();
    const result = await savePackingDefaults(settings);
    setNotice(result?.message || "");
    if (!result?.ok) setError(result?.message || "Could not save defaults.");
    setWorking(null);
  }

  const repeated = estimate?.blockReason
    && (estimate.missing.some((flag) => flag.message === estimate.blockReason) || estimate.unfit.some((flag) => flag.message === estimate.blockReason));

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-3xl border border-line bg-card p-5">
        <label className="block text-sm font-semibold" htmlFor="pack-order">Order number</label>
        <input id="pack-order" value={number} onChange={(event) => setNumber(event.target.value)} className="w-full rounded-xl border border-line bg-paper px-3 py-2" />
        <Button type="button" disabled={!number.trim() || working !== null} onClick={() => void lookup()}>
          {working === "lookup" ? "Retrieving…" : "Retrieve"}
        </Button>
        {customer ? <p className="text-sm">{customer}</p> : null}
      </section>

      <section className="space-y-3 rounded-3xl border border-line bg-card p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_6rem_auto]">
          <label className="text-sm font-semibold">
            SKU
            <Input aria-label="SKU" value={sku} onChange={(event) => searchSku(event.target.value)} className="mt-1" />
          </label>
          <label className="text-sm font-semibold">
            Qty
            <Input aria-label="Qty" inputMode="decimal" value={qty} onChange={(event) => setQty(event.target.value)} className="mt-1" />
          </label>
          <div className="flex items-end">
            <Button type="button" variant="secondary" disabled={!sku.trim()} onClick={() => addLine()}>Add</Button>
          </div>
        </div>
        {matches.length ? (
          <div className="flex flex-wrap gap-2">
            {matches.map((match) => (
              <button key={match.sku} type="button" className="rounded-full border border-line px-3 py-1 text-sm" onClick={() => addLine(match)}>
                {match.sku} {match.name}
              </button>
            ))}
          </div>
        ) : null}
        {lines.length ? (
          <div className="space-y-2">
            {lines.map((line) => (
              <div key={line.key} className="grid items-center gap-2 md:grid-cols-[9rem_1fr_6rem_auto]">
                <span className="font-mono text-xs">{line.sku || "—"}</span>
                <span className="text-sm">{line.name}</span>
                <Input aria-label={`Qty ${line.sku || line.name}`} inputMode="decimal" value={line.qty} onChange={(event) => setLines(lines.map((item) => item.key === line.key ? { ...item, qty: event.target.value } : item))} />
                <Button type="button" variant="secondary" onClick={() => { setLines(lines.filter((item) => item.key !== line.key)); setEstimate(null); }}>Remove</Button>
              </div>
            ))}
          </div>
        ) : <p>No lines.</p>}
      </section>

      <section className="space-y-3 rounded-3xl border border-line bg-card p-5">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm font-semibold">Pallet
            <Select className="mt-1" aria-label="Pallet" value={palletCode} onChange={(event) => setPalletCode(event.target.value)}>
              {pallets.map((pallet) => <option key={pallet.code} value={pallet.code}>{pallet.name} {pallet.lengthCm}×{pallet.widthCm}</option>)}
            </Select>
          </label>
          <label className="text-sm font-semibold">Max height (cm)
            <Input aria-label="Max height (cm)" inputMode="numeric" value={maxHeightCm} onChange={(event) => setMaxHeightCm(event.target.value)} className="mt-1" />
          </label>
          <label className="text-sm font-semibold">Max gross weight (kg)
            <Input aria-label="Max gross weight (kg)" inputMode="decimal" value={maxWeightKg} onChange={(event) => setMaxWeightKg(event.target.value)} className="mt-1" />
          </label>
          <label className="text-sm font-semibold">Parcel weight (kg)
            <Input aria-label="Parcel weight (kg)" inputMode="decimal" value={maxParcelWeightKg} onChange={(event) => setMaxParcelWeightKg(event.target.value)} className="mt-1" />
          </label>
          <label className="text-sm font-semibold">Parcel length (cm)
            <Input aria-label="Parcel length (cm)" inputMode="numeric" value={maxParcelLengthCm} onChange={(event) => setMaxParcelLengthCm(event.target.value)} className="mt-1" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={!lines.length || working !== null} onClick={() => void estimateShipment()}>
            {working === "estimate" ? "Estimating…" : "Estimate"}
          </Button>
          <Button type="button" variant="secondary" disabled={working !== null} onClick={() => void saveDefaults()}>
            {working === "defaults" ? "Saving" : "Save defaults"}
          </Button>
        </div>
      </section>

      {error ? <p role="alert" className="font-semibold">{error}</p> : null}
      {notice && !error ? <Banner tone="success">{notice}</Banner> : null}

      {estimate ? (
        <section className="space-y-4">
          {estimate.missing.map((flag) => <p key={flag.message} role="alert">{flag.message}</p>)}
          {estimate.unfit.map((flag) => <p key={flag.message} role="alert">{flag.message}</p>)}
          {estimate.blockReason && !repeated ? <p role="alert">{estimate.blockReason}</p> : null}
          <p className="text-sm font-semibold">Parcels {estimate.parcelCount}</p>
          {estimate.parcels.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-grey">
                    <th className="px-2 py-2">SKU</th>
                    <th className="px-2 py-2">Size</th>
                    <th className="px-2 py-2">Weight</th>
                    <th className="px-2 py-2">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {estimate.parcels.map((group) => (
                    <tr key={`${group.sku}-${group.packageNo}`} className="border-b border-line">
                      <td className="px-2 py-2 font-mono text-xs">{group.sku}</td>
                      <td className="px-2 py-2">{group.lengthCm} × {group.widthCm} × {group.heightCm} cm</td>
                      <td className="px-2 py-2">{group.weightKg.toFixed(1)} kg</td>
                      <td className="px-2 py-2">{group.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="text-sm font-semibold">Pallets {estimate.palletCount}</p>
          <div className="grid gap-4 lg:grid-cols-2">
            {estimate.pallets.map((pallet) => (
              <article key={pallet.index} className="space-y-3 rounded-3xl border border-line bg-card p-5">
                <h2 className="text-lg font-semibold">Pallet {pallet.index}</h2>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div><dt className="font-semibold">Footprint</dt><dd>{pallet.lengthCm} × {pallet.widthCm} cm</dd></div>
                  <div><dt className="font-semibold">Height</dt><dd>{pallet.totalHeightCm} cm</dd></div>
                  <div><dt className="font-semibold">Gross</dt><dd>{pallet.grossKg.toFixed(1)} kg</dd></div>
                </dl>
                <PalletLayout pallet={pallet} />
                <ul className="space-y-1 text-sm">
                  {pallet.placements.map((item) => (
                    <li key={item.id}>{item.sku} · {item.lengthCm}×{item.widthCm}×{item.heightCm} cm · {item.weightKg.toFixed(1)} kg</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          {estimate.readyForInvoice ? (
            <Button type="button" disabled={working !== null} onClick={() => void sendToInvoice()}>
              {working === "save" ? "Saving…" : "Use in commercial invoice"}
            </Button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
