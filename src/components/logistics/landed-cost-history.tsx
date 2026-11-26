"use client";

import { useEffect, useState } from "react";
import { formatGbp } from "@/features/logistics/landed-cost/money";

type Item = {
  id: string;
  created_at: string;
  mode: string;
  document_number: string | null;
  destination_country: string;
  origin_country: string | null;
  incoterm: string;
  estimate: boolean;
  result: { landedPence?: number; totals?: { landedPence?: number } | null };
};

export function LandedHistory() {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/logistics/landed-cost/history");
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "Saved calculations could not be read.");
      return;
    }
    setItems(body.items ?? []);
  }

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, []);

  async function remove(id: string) {
    const response = await fetch(`/api/logistics/landed-cost/history/${id}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "That calculation could not be deleted.");
      return;
    }
    setItems((current) => current.filter((item) => item.id !== id));
  }

  if (error) return <p role="alert" className="font-semibold text-red">{error}</p>;
  if (!items.length) return <p className="text-sm font-semibold">No saved calculations.</p>;
  return (
    <div className="overflow-x-auto rounded-3xl border border-line">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line">
            <th className="p-3">Date</th>
            <th className="p-3">Order</th>
            <th className="p-3">Route</th>
            <th className="p-3">Landed cost</th>
            <th className="p-3" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const landed = item.result?.totals?.landedPence ?? item.result?.landedPence;
            return (
              <tr key={item.id} className="border-b border-line">
                <td className="p-3">{new Date(item.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
                <td className="p-3">{item.document_number || item.mode}</td>
                <td className="p-3">{item.origin_country ? `${item.origin_country} → ${item.destination_country}` : item.destination_country} · {item.incoterm}{item.estimate ? " · Estimate" : ""}</td>
                <td className="p-3 font-semibold tabular-nums">{typeof landed === "number" ? formatGbp(landed) : ""}</td>
                <td className="p-3">
                  <a className="font-semibold" href={`/api/logistics/landed-cost/history/${item.id}?format=csv`}>CSV</a>
                  <a className="ml-3 font-semibold" href={`/api/logistics/landed-cost/history/${item.id}?format=pdf`}>PDF</a>
                  <button type="button" className="ml-3 font-semibold" onClick={() => void remove(item.id)}>Delete</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
