"use client";

import { useEffect, useState, type FormEvent } from "react";
import { countryChoices } from "@/features/logistics/commercial-invoice/rules";
import { INCOTERMS } from "@/features/logistics/landed-cost/calculate";
import { shipmentCsv } from "@/features/logistics/landed-cost/csv";
import { formatGbp, londonDate } from "@/features/logistics/landed-cost/money";
import type { ShipmentQuote } from "@/features/logistics/landed-cost/shipment";
import { fieldClass, labelClass, primaryClass, secondaryClass } from "@/components/logistics/landed-cost-result";

type LoadedLine = {
  sku: string | null;
  description: string;
  quantity: number;
  goodsValue: number | null;
  hsCode: string | null;
  originCountry: string | null;
};

type Loaded = {
  kind: "sale" | "purchase";
  number: string;
  party: string | null;
  currency: string | null;
  destination: string | null;
  lines: LoadedLine[];
};

const countries = countryChoices();

export function LandedShipment() {
  const [kind, setKind] = useState<"sale" | "purchase">("purchase");
  const [number, setNumber] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [lines, setLines] = useState<LoadedLine[]>([]);
  const [destination, setDestination] = useState("GB");
  const [incoterm, setIncoterm] = useState("FOB");
  const [currency, setCurrency] = useState("USD");
  const [freight, setFreight] = useState("");
  const [insurance, setInsurance] = useState("");
  const [other, setOther] = useState("");
  const [afterBorder, setAfterBorder] = useState("");
  const [asOf, setAsOf] = useState(londonDate());
  const [rate, setRate] = useState("");
  const [rateTouched, setRateTouched] = useState(false);
  const [claimPreference, setClaimPreference] = useState(true);
  const [quote, setQuote] = useState<ShipmentQuote | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loaded || currency === "GBP" || rateTouched) return;
    const timer = setTimeout(() => {
      void fetch(`/api/logistics/landed-cost?currency=${currency}&date=${asOf}`)
        .then((response) => response.json())
        .then((body: { unitsPerGbp?: number }) => { if (typeof body.unitsPerGbp === "number") setRate(String(body.unitsPerGbp)); })
        .catch(() => undefined);
    }, 200);
    return () => clearTimeout(timer);
  }, [currency, asOf, rateTouched, loaded]);

  function body(action: "load" | "calculate") {
    const amount = (value: string) => value.trim() ? Number(value) : 0;
    return {
      action,
      kind,
      number,
      destination,
      incoterm,
      freight: amount(freight),
      insurance: amount(insurance),
      otherCharges: amount(other),
      afterBorder: ["DAP", "DPU", "DDP"].includes(incoterm) ? amount(afterBorder) : 0,
      currency,
      rateOverride: currency !== "GBP" && rateTouched ? Number(rate) : null,
      asOf,
      claimPreference,
      lines: lines.map((line) => ({ hsCode: line.hsCode ?? "", originCountry: line.originCountry ?? "" })),
    };
  }

  async function load(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setQuote(null);
    setSavedId(null);
    const response = await fetch("/api/logistics/landed-cost/shipment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body("load")) });
    const payload = await response.json();
    setBusy(false);
    if (!response.ok) {
      setLoaded(null);
      setError(payload.error || "That order could not be loaded.");
      return;
    }
    const loaded = payload as Loaded;
    setLoaded(loaded);
    setLines(loaded.lines);
    if (loaded.destination) setDestination(loaded.destination);
    if (loaded.currency) setCurrency(loaded.currency);
    setRateTouched(false);
  }

  async function calculate() {
    setBusy(true);
    setError("");
    setSavedId(null);
    const response = await fetch("/api/logistics/landed-cost/shipment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body("calculate")) });
    const payload = await response.json();
    setBusy(false);
    if (!response.ok) {
      setQuote(null);
      setError(payload.error || "The shipment could not be calculated.");
      return;
    }
    setQuote(payload.quote as ShipmentQuote);
  }

  async function save() {
    const response = await fetch("/api/logistics/landed-cost/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body("calculate"), mode: "shipment" }) });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error || "The calculation could not be saved.");
      return;
    }
    setSavedId(payload.id);
    setQuote(payload.quote);
  }

  function downloadCsv() {
    if (!quote) return;
    const blob = new Blob([shipmentCsv(quote)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `landed-cost-${loaded?.number ?? "shipment"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void load(event)}>
        <label className={labelClass}>Order
          <select className={fieldClass} value={kind} onChange={(event) => setKind(event.currentTarget.value as "sale" | "purchase")}>
            <option value="purchase">Purchase</option>
            <option value="sale">Sale</option>
          </select>
        </label>
        <label className={labelClass}>Number<input className={fieldClass} value={number} onChange={(event) => setNumber(event.currentTarget.value)} /></label>
        <button className={primaryClass} type="submit" disabled={busy}>Load</button>
      </form>
      {error ? <p role="alert" className="font-semibold text-red">{error}</p> : null}
      {loaded ? (
        <div className="space-y-4 rounded-3xl border border-line bg-card p-5">
          <p className="font-semibold">{loaded.number}{loaded.party ? ` · ${loaded.party}` : ""}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="p-2">SKU</th>
                  <th className="p-2">Description</th>
                  <th className="p-2">Qty</th>
                  <th className="p-2">Value</th>
                  <th className="p-2">Commodity</th>
                  <th className="p-2">Origin</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={`${line.sku ?? "line"}-${index}`} className="border-b border-line">
                    <td className="p-2">{line.sku}</td>
                    <td className="p-2">{line.description}</td>
                    <td className="p-2 tabular-nums">{line.quantity}</td>
                    <td className="p-2 tabular-nums">{line.goodsValue ?? ""}</td>
                    <td className="p-2"><input className={fieldClass} value={line.hsCode ?? ""} onChange={(event) => setLines(lines.map((item, itemIndex) => itemIndex === index ? { ...item, hsCode: event.currentTarget.value } : item))} /></td>
                    <td className="p-2"><input className={`${fieldClass} w-20`} value={line.originCountry ?? ""} maxLength={2} onChange={(event) => setLines(lines.map((item, itemIndex) => itemIndex === index ? { ...item, originCountry: event.currentTarget.value.toUpperCase() } : item))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lines.length === 0 ? <p className="text-sm font-semibold">No goods lines.</p> : null}
          <div className="grid gap-3 md:grid-cols-3">
            <label className={labelClass}>Destination
              <select className={fieldClass} value={destination} onChange={(event) => setDestination(event.currentTarget.value)}>
                {countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
              </select>
            </label>
            <label className={labelClass}>Incoterm
              <select className={fieldClass} value={incoterm} onChange={(event) => setIncoterm(event.currentTarget.value)}>
                {INCOTERMS.map((term) => <option key={term}>{term}</option>)}
              </select>
            </label>
            <label className={labelClass}>Currency<input className={fieldClass} value={currency} maxLength={3} onChange={(event) => { setCurrency(event.currentTarget.value.toUpperCase()); setRateTouched(false); }} /></label>
            <label className={labelClass}>Freight<input className={fieldClass} inputMode="decimal" value={freight} onChange={(event) => setFreight(event.currentTarget.value)} /></label>
            <label className={labelClass}>Insurance<input className={fieldClass} inputMode="decimal" value={insurance} onChange={(event) => setInsurance(event.currentTarget.value)} /></label>
            <label className={labelClass}>Other charges<input className={fieldClass} inputMode="decimal" value={other} onChange={(event) => setOther(event.currentTarget.value)} /></label>
            {["DAP", "DPU", "DDP"].includes(incoterm) ? <label className={labelClass}>After border<input className={fieldClass} inputMode="decimal" value={afterBorder} onChange={(event) => setAfterBorder(event.currentTarget.value)} /></label> : null}
            <label className={labelClass}>Date<input className={fieldClass} type="date" value={asOf} onChange={(event) => { setAsOf(event.currentTarget.value); setRateTouched(false); }} /></label>
            <label className={labelClass}>Units per £1<input className={fieldClass} inputMode="decimal" value={currency === "GBP" ? "1" : rate} disabled={currency === "GBP"} onChange={(event) => { setRate(event.currentTarget.value); setRateTouched(true); }} /></label>
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={claimPreference} onChange={(event) => setClaimPreference(event.currentTarget.checked)} />Claim preference</label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={primaryClass} type="button" disabled={busy} onClick={() => void calculate()}>{busy ? "Calculating" : "Calculate"}</button>
            {quote ? <button className={secondaryClass} type="button" onClick={() => void save()}>Save</button> : null}
            {quote ? <button className={secondaryClass} type="button" onClick={downloadCsv}>CSV</button> : null}
            {savedId ? <a className={`${secondaryClass} inline-block`} href={`/api/logistics/landed-cost/history/${savedId}?format=pdf`}>PDF</a> : null}
          </div>
        </div>
      ) : null}
      {quote?.totals ? (
        <section className="rounded-3xl border border-line bg-card p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Landed cost</p>
            {quote.estimate ? <span className="rounded-full border border-line px-2 py-0.5 text-xs font-semibold">Estimate</span> : null}
          </div>
          <p className="mt-1 font-display text-4xl tabular-nums">{formatGbp(quote.totals.landedPence)}</p>
          <dl className="mt-4 text-sm">
            <div className="flex justify-between border-b border-line py-2"><dt>Customs value</dt><dd className="font-semibold tabular-nums">{formatGbp(quote.totals.customsValuePence)}</dd></div>
            <div className="flex justify-between border-b border-line py-2"><dt>Duty</dt><dd className="font-semibold tabular-nums">{formatGbp(quote.totals.dutyPence)}</dd></div>
            <div className="flex justify-between border-b border-line py-2"><dt>VAT</dt><dd className="font-semibold tabular-nums">{formatGbp(quote.totals.vatPence)}</dd></div>
            <div className="flex justify-between border-b border-line py-2"><dt>Other charges</dt><dd className="font-semibold tabular-nums">{formatGbp(quote.totals.otherChargesPence)}</dd></div>
          </dl>
          {quote.stale ? <p role="alert" className="mt-3 text-sm font-semibold">Tariff service unavailable.</p> : null}
          <ul className="mt-4 space-y-2 text-sm">
            {quote.lines.map((line, index) => (
              <li key={`${line.sku ?? "line"}-${index}`} className="flex justify-between gap-4">
                <span>{line.sku || line.description}</span>
                <span className="font-semibold tabular-nums">{line.result ? formatGbp(line.result.landedPence) : line.error}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
