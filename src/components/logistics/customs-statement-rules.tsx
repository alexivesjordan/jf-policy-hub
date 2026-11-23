"use client";

import { useState } from "react";
import type { StatementRule } from "@/features/logistics/commercial-invoice/statements";

type Rule = StatementRule & { id: string };
const blank = { incoterm: "", destinationCountry: "", carrier: "", statementText: "", extraLine: "", priority: 0, active: true };

export function CustomsStatementRules({ initial }: { initial: Rule[] }) {
  const [rules, setRules] = useState<Rule[]>(initial);
  const [draft, setDraft] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/logistics/customs-statements");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "The rules could not be read.");
    setRules(json.rules ?? []);
  }

  async function save(body: Record<string, unknown>) {
    setError("");
    const res = await fetch("/api/logistics/customs-statements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "That rule could not be saved.");
    await load();
  }

  return (
    <div className="space-y-4">
      {error ? <p role="alert" className="font-semibold">{error}</p> : null}
      <div className="overflow-x-auto rounded-3xl border border-line">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="p-3">Incoterm</th>
              <th className="p-3">Destination</th>
              <th className="p-3">Carrier</th>
              <th className="p-3">Statement</th>
              <th className="p-3">Priority</th>
              <th className="p-3">Active</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id} className="border-b border-line">
                <td className="p-3">{rule.incoterm || "Any"}</td>
                <td className="p-3">{rule.destinationCountry || "Any"}</td>
                <td className="p-3">{rule.carrier || "Any"}</td>
                <td className="p-3">{rule.statementText}{rule.extraLine ? ` / ${rule.extraLine}` : ""}</td>
                <td className="p-3">{rule.priority}</td>
                <td className="p-3">{rule.active ? "Yes" : "No"}</td>
                <td className="p-3">
                  <button type="button" className="font-semibold" onClick={() => { setEditing(rule.id); setDraft({ incoterm: rule.incoterm ?? "", destinationCountry: rule.destinationCountry ?? "", carrier: rule.carrier ?? "", statementText: rule.statementText, extraLine: rule.extraLine ?? "", priority: rule.priority, active: rule.active }); }}>Edit</button>
                  {rule.active ? <button type="button" className="ml-3 font-semibold" onClick={() => void save({ id: rule.id, incoterm: rule.incoterm, destinationCountry: rule.destinationCountry, carrier: rule.carrier, statementText: rule.statementText, extraLine: rule.extraLine, priority: rule.priority, active: false }).catch((err: unknown) => setError(err instanceof Error ? err.message : "That rule could not be saved."))}>Deactivate</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="grid gap-3 rounded-3xl border border-line bg-card p-5 md:grid-cols-3" onSubmit={(event) => {
        event.preventDefault();
        void save({
          id: editing ?? undefined,
          incoterm: draft.incoterm || null,
          destinationCountry: draft.destinationCountry || null,
          carrier: draft.carrier || null,
          statementText: draft.statementText,
          extraLine: draft.extraLine || null,
          priority: Number(draft.priority),
          active: draft.active,
        }).then(() => { setDraft(blank); setEditing(null); }).catch((err: unknown) => setError(err instanceof Error ? err.message : "That rule could not be saved."));
      }}>
        <label className="text-sm font-semibold">Incoterm<input className="mt-1 w-full rounded-xl border border-line px-3 py-2" value={draft.incoterm} onChange={(event) => setDraft({ ...draft, incoterm: event.currentTarget.value })} /></label>
        <label className="text-sm font-semibold">Destination<input className="mt-1 w-full rounded-xl border border-line px-3 py-2" value={draft.destinationCountry} onChange={(event) => setDraft({ ...draft, destinationCountry: event.currentTarget.value })} /></label>
        <label className="text-sm font-semibold">Carrier<input className="mt-1 w-full rounded-xl border border-line px-3 py-2" value={draft.carrier} onChange={(event) => setDraft({ ...draft, carrier: event.currentTarget.value })} /></label>
        <label className="text-sm font-semibold md:col-span-2">Statement<span className="mt-1 block text-xs font-normal opacity-70">Use {"{buyerVat}"} for the customer's VAT number.</span><textarea className="mt-1 w-full rounded-xl border border-line px-3 py-2" rows={3} value={draft.statementText} onChange={(event) => setDraft({ ...draft, statementText: event.currentTarget.value })} /></label>
        <label className="text-sm font-semibold">Extra line<input className="mt-1 w-full rounded-xl border border-line px-3 py-2" value={draft.extraLine} onChange={(event) => setDraft({ ...draft, extraLine: event.currentTarget.value })} /></label>
        <label className="text-sm font-semibold">Priority<input type="number" className="mt-1 w-full rounded-xl border border-line px-3 py-2" value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: Number(event.currentTarget.value) })} /></label>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.currentTarget.checked })} />Active</label>
        <button type="submit" className="rounded-xl bg-red px-4 py-2 font-semibold text-white">{editing ? "Save" : "Add"}</button>
      </form>
    </div>
  );
}
