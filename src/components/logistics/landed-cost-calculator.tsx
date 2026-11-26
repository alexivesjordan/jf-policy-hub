"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { countryChoices } from "@/features/logistics/commercial-invoice/rules";
import { INCOTERMS } from "@/features/logistics/landed-cost/calculate";
import { quoteCsv } from "@/features/logistics/landed-cost/csv";
import { londonDate } from "@/features/logistics/landed-cost/money";
import type { QuoteView } from "@/features/logistics/landed-cost/quote";
import { fieldClass, labelClass, LandedResult, primaryClass, secondaryClass } from "@/components/logistics/landed-cost-result";

const countries = countryChoices();
const pinned = ["CN", "VN", "TW", "GB", "DE", "FR", "NL", "IE", "US", "AE"];
const ordered = [...countries].sort((left, right) => {
  const leftRank = pinned.indexOf(left.code);
  const rightRank = pinned.indexOf(right.code);
  const leftOrder = leftRank === -1 ? pinned.length : leftRank;
  const rightOrder = rightRank === -1 ? pinned.length : rightRank;
  return leftOrder - rightOrder || left.name.localeCompare(right.name, "en");
});
const pinnedCountries = ordered.filter((country) => pinned.includes(country.code));
const clientCountries = () => true;
const serverCountries = () => false;

function useCountryOptions() {
  const client = useSyncExternalStore(() => () => {}, clientCountries, serverCountries);
  return client ? ordered : pinnedCountries;
}
const arrival = new Set(["DAP", "DPU", "DDP"]);

type Hit = { code: string; description: string };

function amount(value: string) {
  if (!value.trim()) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function LandedCalculator() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [origin, setOrigin] = useState("CN");
  const [destination, setDestination] = useState("GB");
  const [incoterm, setIncoterm] = useState<(typeof INCOTERMS)[number]>("FOB");
  const [goods, setGoods] = useState("");
  const [freight, setFreight] = useState("");
  const [insurance, setInsurance] = useState("");
  const [other, setOther] = useState("");
  const [afterBorder, setAfterBorder] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [asOf, setAsOf] = useState(londonDate());
  const [rate, setRate] = useState("");
  const [rateTouched, setRateTouched] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [weight, setWeight] = useState("");
  const [claimPreference, setClaimPreference] = useState(true);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const countryOptions = useCountryOptions();

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const timer = setTimeout(() => {
      void fetch(`/api/logistics/landed-cost?q=${encodeURIComponent(q)}`)
        .then((response) => response.json())
        .then((body: { items?: Hit[] }) => setHits(body.items ?? []))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (currency === "GBP" || rateTouched) return;
    const timer = setTimeout(() => {
      void fetch(`/api/logistics/landed-cost?currency=${currency}&date=${asOf}`)
        .then((response) => response.json())
        .then((body: { unitsPerGbp?: number }) => {
          if (typeof body.unitsPerGbp === "number") setRate(String(body.unitsPerGbp));
        })
        .catch(() => undefined);
    }, 200);
    return () => clearTimeout(timer);
  }, [currency, asOf, rateTouched]);

  function payload() {
    return {
      destination,
      origin,
      commodityCode: code || query,
      incoterm,
      goodsValue: amount(goods),
      freight: amount(freight),
      insurance: amount(insurance),
      otherCharges: amount(other),
      afterBorder: arrival.has(incoterm) ? amount(afterBorder) : 0,
      currency,
      rateOverride: currency !== "GBP" && rateTouched ? amount(rate) : null,
      asOf,
      quantity: quantity.trim() ? amount(quantity) : null,
      netWeightKg: weight.trim() ? amount(weight) : null,
      claimPreference,
    };
  }

  async function calculate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSavedId(null);
    const response = await fetch("/api/logistics/landed-cost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setQuote(null);
      setError(body.error || "The calculation could not be completed.");
      return;
    }
    setQuote(body as QuoteView);
    if (body.description) setDescription(body.description);
    if (body.commodityCode) setCode(body.commodityCode);
  }

  async function save() {
    setError("");
    const response = await fetch("/api/logistics/landed-cost/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "The calculation could not be saved.");
      return;
    }
    setSavedId(body.id);
    setQuote(body.quote);
  }

  function downloadCsv() {
    if (!quote) return;
    const blob = new Blob([quoteCsv(quote)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `landed-cost-${quote.commodityCode}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={quote ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start" : ""}>
      <form className="grid gap-3 rounded-3xl border border-line bg-card p-5 md:grid-cols-2" onSubmit={(event) => void calculate(event)}>
        <label className={`${labelClass} md:col-span-2`}>
          Commodity
          <input className={fieldClass} value={query} onChange={(event) => { setQuery(event.currentTarget.value); setCode(""); setDescription(""); }} autoComplete="off" />
        </label>
        {description ? <p className="md:col-span-2 text-sm font-semibold">{code} · {description}</p> : null}
        {hits.length && !code ? (
          <ul className="md:col-span-2 max-h-48 overflow-auto rounded-xl border border-line">
            {hits.map((hit) => (
              <li key={hit.code}>
                <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-mist" onClick={() => { setCode(hit.code); setQuery(hit.code); setDescription(hit.description); setHits([]); }}>
                  {hit.code} · {hit.description}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <label className={labelClass}>Origin
          <select className={fieldClass} value={origin} onChange={(event) => setOrigin(event.currentTarget.value)}>
            {countryOptions.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
          </select>
        </label>
        <label className={labelClass}>Destination
          <select className={fieldClass} value={destination} onChange={(event) => setDestination(event.currentTarget.value)}>
            {countryOptions.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
          </select>
        </label>
        <label className={labelClass}>Incoterm
          <select className={fieldClass} value={incoterm} onChange={(event) => setIncoterm(event.currentTarget.value as (typeof INCOTERMS)[number])}>
            {INCOTERMS.map((term) => <option key={term}>{term}</option>)}
          </select>
        </label>
        <label className={labelClass}>Currency
          <input className={fieldClass} value={currency} maxLength={3} onChange={(event) => { setCurrency(event.currentTarget.value.toUpperCase()); setRateTouched(false); }} />
        </label>
        <label className={labelClass}>Goods value<input className={fieldClass} inputMode="decimal" value={goods} onChange={(event) => setGoods(event.currentTarget.value)} /></label>
        <label className={labelClass}>Freight<input className={fieldClass} inputMode="decimal" value={freight} onChange={(event) => setFreight(event.currentTarget.value)} /></label>
        <label className={labelClass}>Insurance<input className={fieldClass} inputMode="decimal" value={insurance} onChange={(event) => setInsurance(event.currentTarget.value)} /></label>
        <label className={labelClass}>Other charges<input className={fieldClass} inputMode="decimal" value={other} onChange={(event) => setOther(event.currentTarget.value)} /></label>
        {arrival.has(incoterm) ? <label className={labelClass}>After border<input className={fieldClass} inputMode="decimal" value={afterBorder} onChange={(event) => setAfterBorder(event.currentTarget.value)} /></label> : null}
        <label className={labelClass}>Date<input className={fieldClass} type="date" value={asOf} onChange={(event) => { setAsOf(event.currentTarget.value); setRateTouched(false); }} /></label>
        <label className={labelClass}>Units per £1
          <input className={fieldClass} inputMode="decimal" value={currency === "GBP" ? "1" : rate} disabled={currency === "GBP"} onChange={(event) => { setRate(event.currentTarget.value); setRateTouched(true); }} />
        </label>
        <label className={labelClass}>Quantity<input className={fieldClass} inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.currentTarget.value)} /></label>
        <label className={labelClass}>Net weight kg<input className={fieldClass} inputMode="decimal" value={weight} onChange={(event) => setWeight(event.currentTarget.value)} /></label>
        <label className="flex items-center gap-2 text-sm font-semibold md:col-span-2">
          <input type="checkbox" checked={claimPreference} onChange={(event) => setClaimPreference(event.currentTarget.checked)} />
          Claim preference
        </label>
        {error ? <p role="alert" className="font-semibold text-red md:col-span-2">{error}</p> : null}
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <button className={primaryClass} type="submit" disabled={busy}>{busy ? "Calculating" : "Calculate"}</button>
          {quote ? <button className={secondaryClass} type="button" onClick={() => void save()}>Save</button> : null}
          {quote ? <button className={secondaryClass} type="button" onClick={downloadCsv}>CSV</button> : null}
          {savedId ? <a className={`${secondaryClass} inline-block`} href={`/api/logistics/landed-cost/history/${savedId}?format=pdf`}>PDF</a> : null}
        </div>
      </form>
      {quote ? <LandedResult quote={quote} /> : null}
    </div>
  );
}
