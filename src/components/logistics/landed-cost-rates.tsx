"use client";

import { useEffect, useState, type FormEvent } from "react";
import { countryChoices } from "@/features/logistics/commercial-invoice/rules";
import type { ManualRate } from "@/features/logistics/landed-cost/manual-rates";
import { fieldClass, labelClass, primaryClass } from "@/components/logistics/landed-cost-result";

type StoredRate = ManualRate & { id: string };

export function LandedRates() {
  const [rates, setRates] = useState<StoredRate[]>([]);
  const [destination, setDestination] = useState("DE");
  const [origin, setOrigin] = useState("");
  const [hsPrefix, setHsPrefix] = useState("");
  const [duty, setDuty] = useState("");
  const [vat, setVat] = useState("");
  const [error, setError] = useState("");
  const countries = countryChoices();

  async function load() {
    const response = await fetch("/api/logistics/landed-cost/rates");
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "Stored rates could not be read.");
      return;
    }
    setRates(body.rates ?? []);
  }

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/logistics/landed-cost/rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destination,
        origin: origin || null,
        hsPrefix,
        dutyPercent: Number(duty),
        vatPercent: Number(vat),
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "That rate could not be saved.");
      return;
    }
    setRates(body.rates ?? []);
    setHsPrefix("");
    setDuty("");
    setVat("");
  }

  async function remove(id: string) {
    setError("");
    const response = await fetch("/api/logistics/landed-cost/rates", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "That rate could not be deleted.");
      return;
    }
    setRates(body.rates ?? []);
  }

  return (
    <div className="space-y-4">
      {error ? <p role="alert" className="font-semibold text-red">{error}</p> : null}
      {rates.length === 0 ? <p className="text-sm font-semibold">No stored rates.</p> : (
        <div className="overflow-x-auto rounded-3xl border border-line">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="p-3">Destination</th>
                <th className="p-3">Origin</th>
                <th className="p-3">HS</th>
                <th className="p-3">Duty %</th>
                <th className="p-3">VAT %</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {rates.map((rate) => (
                <tr key={rate.id} className="border-b border-line">
                  <td className="p-3">{rate.destination}</td>
                  <td className="p-3">{rate.origin || "Any"}</td>
                  <td className="p-3">{rate.hsPrefix}</td>
                  <td className="p-3 tabular-nums">{rate.dutyPercent}</td>
                  <td className="p-3 tabular-nums">{rate.vatPercent}</td>
                  <td className="p-3"><button type="button" className="font-semibold" onClick={() => void remove(rate.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="grid gap-3 rounded-3xl border border-line bg-card p-5 md:grid-cols-3" onSubmit={(event) => void save(event)}>
        <label className={labelClass}>Destination
          <select className={fieldClass} value={destination} onChange={(event) => setDestination(event.currentTarget.value)}>
            {countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
          </select>
        </label>
        <label className={labelClass}>Origin
          <select className={fieldClass} value={origin} onChange={(event) => setOrigin(event.currentTarget.value)}>
            <option value="">Any</option>
            {countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
          </select>
        </label>
        <label className={labelClass}>HS chapter<input className={fieldClass} value={hsPrefix} onChange={(event) => setHsPrefix(event.currentTarget.value)} /></label>
        <label className={labelClass}>Duty %<input className={fieldClass} inputMode="decimal" value={duty} onChange={(event) => setDuty(event.currentTarget.value)} /></label>
        <label className={labelClass}>VAT %<input className={fieldClass} inputMode="decimal" value={vat} onChange={(event) => setVat(event.currentTarget.value)} /></label>
        <div className="flex items-end"><button className={primaryClass} type="submit">Add</button></div>
      </form>
    </div>
  );
}
