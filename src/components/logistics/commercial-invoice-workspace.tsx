"use client";

import { useRef, useState } from "react";
import { commercialInvoiceFileName } from "@/features/logistics/commercial-invoice/filename";
import { inspectPallets, palletGrossKg } from "@/features/logistics/commercial-invoice/pallets";
import { CUSTOMS_STATEMENTS } from "@/features/logistics/commercial-invoice/seller";
import { matchCustomsStatement, type StatementRule } from "@/features/logistics/commercial-invoice/statements";
import { commercialInvoiceBody } from "@/features/logistics/commercial-invoice/shipment-input";
import { goodsTotal, summedNetWeightKg, type InvoiceDraft, type InvoiceOrder, type InvoiceShipment } from "@/features/logistics/commercial-invoice/rules";

type PalletInput = { lengthCm: string; widthCm: string; depthCm: string; weightKg: string };
const emptyPallet = (): PalletInput => ({ lengthCm: "", widthCm: "", depthCm: "", weightKg: "" });

const TERMS = ["DAP", "DDP", "EXW", "FCA", "CPT", "CIP", "DPU", "FOB", "CIF"];

export function CommercialInvoiceWorkspace() {
  const [numbers, setNumbers] = useState("");
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const [working, setWorking] = useState<"lookup" | "preview" | "issue" | null>(null);
  const [error, setError] = useState("");
  const [details, setDetails] = useState<string[]>([]);
  const [issued, setIssued] = useState("");
  const [palletRows, setPalletRows] = useState<PalletInput[]>([emptyPallet()]);
  const [rules, setRules] = useState<StatementRule[]>([]);

  async function lookup() {
    void fetch("/api/logistics/customs-statements").then(async (res) => {
      if (!res.ok) return;
      const json = await res.json();
      setRules(Array.isArray(json.rules) ? json.rules : []);
    }).catch(() => undefined);
    setError("");
    setDetails([]);
    setIssued("");
    setWorking("lookup");
    try {
      const res = await fetch("/api/logistics/commercial-invoices/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumbers: numbers }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Cin7 lookup failed.");
      const found = json.orders as InvoiceOrder[];
      if (!found.length) throw new Error("No orders.");
      setDraft({
        reference: "PREVIEW",
        issueDate: new Date().toISOString().slice(0, 10),
        currency: found[0]?.currency ?? "",
        orders: found.map((order) => order.orderNumber),
        seller: found[0] ? { ...found[0].buyer, name: "Jordan Fitness Ltd", address: "", vat: "", eori: "" } : { name: "", address: "", vat: "", eori: "" },
        buyer: found[0]?.buyer ?? { name: "", address: "", vat: "", eori: "" },
        consignee: found[0]?.consignee ?? { name: "", address: "", vat: "", eori: "" },
        importer: { name: "", address: "", vat: "", eori: "" },
        frenchVatNumber: "",
        frenchFiscalRepresentativeVat: "",
        ddpModel: "not_applicable",
        carrier: "Other",
        entryCountry: "",
        clearanceCountry: "",
        destinationCountry: found[0]?.country ?? "",
        incoterm: "DAP",
        namedPlace: "",
        procedure: "unconfirmed",
        approvedStatement: "",
        statementApprovedBy: "",
        reasonForExport: "Sale of goods",
        packages: 1,
        packageType: "Carton",
        netWeightKg: 0,
        grossWeightKg: 0,
        freightValue: 0,
        insuranceValue: 0,
        otherChargesValue: 0,
        shipmentRef: "",
        signatory: "Jordan Fitness Ltd",
        notes: "",
        physicalShipmentConfirmed: true,
        lines: found.flatMap((order) => order.lines),
        shipment: {
          fao: "",
          courier: "",
          despatchDate: new Date().toISOString().slice(0, 10),
          deliveryAddress: found[0]?.consignee.address ?? "",
          contactName: "",
          contactEmail: "",
          specialInstructions: [...new Set(found.map((order) => order.specialInstructions?.trim()).filter((note): note is string => Boolean(note)))].join("\n"),
          parcels: 1,
          pallets: 0,
          palletLines: [],
          deliveryPence: found.reduce((sum, order) => sum + (order.deliveryPence ?? 0), 0),
          surchargePence: 0,
          vatPence: 0,
          customsStatementId: "matched",
          customsStatementText: "",
          issuedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      setDraft(null);
      setError(err instanceof Error ? err.message : "Order lookup failed.");
    } finally {
      setWorking(null);
    }
  }

  function rawPallets() {
    return palletRows.map((row) => ({
      lengthCm: row.lengthCm === "" ? null : Number(row.lengthCm),
      widthCm: row.widthCm === "" ? null : Number(row.widthCm),
      depthCm: row.depthCm === "" ? null : Number(row.depthCm),
      weightKg: row.weightKg === "" ? null : Number(row.weightKg),
    }));
  }

  function enteredPallets() {
    return inspectPallets(rawPallets(), "issue");
  }

  function payload() {
    if (!draft) return null;
    const pallets = enteredPallets();
    return commercialInvoiceBody(draft, rawPallets(), pallets.pallets.length, palletGrossKg(pallets.pallets));
  }

  async function preview() {
    const body = payload();
    if (!body || !draft) return;
    const palletErrors = inspectPallets(rawPallets(), "preview").problems;
    if (palletErrors.length) {
      setError("A pallet is invalid.");
      setDetails(palletErrors);
      return;
    }
    setWorking("preview");
    setError("");
    setDetails([]);
    try {
      const res = await fetch("/api/logistics/commercial-invoices/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json();
        setDetails(Array.isArray(json.details) ? json.details : []);
        throw new Error(json.error || "The PDF could not be generated.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = commercialInvoiceFileName({ buyer: draft.buyer.name, number: "PREVIEW", incoterm: draft.incoterm });
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The PDF could not be generated.");
    } finally {
      setWorking(null);
    }
  }

  async function issue() {
    const body = payload();
    if (!body || !draft) return;
    const palletErrors = enteredPallets().problems;
    if (palletErrors.length) {
      setError("A pallet is invalid.");
      setDetails(palletErrors);
      return;
    }
    setWorking("issue");
    setError("");
    setDetails([]);
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
    try {
      const res = await fetch("/api/logistics/commercial-invoices/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, idempotencyKey: idempotencyKey.current }),
      });
      const json = await res.json();
      if (!res.ok) {
        setDetails(Array.isArray(json.details) ? json.details : []);
        throw new Error(json.error || "That invoice could not be saved.");
      }
      setIssued(json.number);
      idempotencyKey.current = null;
      const file = await fetch(`/api/logistics/commercial-invoices/${json.id}`);
      if (file.ok) {
        const url = URL.createObjectURL(await file.blob());
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = json.filename;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "That invoice could not be saved.");
    } finally {
      setWorking(null);
    }
  }

  function patchShipment(patch: Partial<InvoiceShipment>) {
    setDraft((current) => current?.shipment ? { ...current, shipment: { ...current.shipment, ...patch } } : current);
  }

  const net = draft ? summedNetWeightKg(draft.lines) : 0;
  const shipment = draft?.shipment;
  const gross = palletGrossKg(enteredPallets().pallets);
  const suggested = draft ? matchCustomsStatement(rules, { incoterm: draft.incoterm, destinationCountry: draft.destinationCountry, carrier: shipment?.courier ?? "" }) : "";
  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-3xl border border-line bg-card p-5">
        <h2 className="text-lg font-semibold">Orders</h2>
        <label className="block text-sm font-semibold" htmlFor="invoice-orders">Order numbers</label>
        <textarea id="invoice-orders" rows={2} value={numbers} onChange={(event) => setNumbers(event.currentTarget.value)} className="w-full rounded-xl border border-line bg-paper p-3" />
        <div className="space-y-2">
          <p className="text-sm font-semibold">Pallets</p>
          <div className="grid grid-cols-5 gap-2 text-sm font-semibold">
            <span>L (cm)</span>
            <span>W (cm)</span>
            <span>D (cm)</span>
            <span>Weight (kg)</span>
          </div>
          {palletRows.map((row, index) => (
            <div key={index} className="grid grid-cols-5 gap-2">
              <input aria-label="Length cm" inputMode="numeric" type="number" min={1} max={1000} step={1} className="rounded-xl border border-line px-2 py-2" value={row.lengthCm} onChange={(event) => setPalletRows(palletRows.map((item, itemIndex) => itemIndex === index ? { ...item, lengthCm: event.currentTarget.value } : item))} />
              <input aria-label="Width cm" inputMode="numeric" type="number" min={1} max={1000} step={1} className="rounded-xl border border-line px-2 py-2" value={row.widthCm} onChange={(event) => setPalletRows(palletRows.map((item, itemIndex) => itemIndex === index ? { ...item, widthCm: event.currentTarget.value } : item))} />
              <input aria-label="Depth cm" inputMode="numeric" type="number" min={1} max={1000} step={1} className="rounded-xl border border-line px-2 py-2" value={row.depthCm} onChange={(event) => setPalletRows(palletRows.map((item, itemIndex) => itemIndex === index ? { ...item, depthCm: event.currentTarget.value } : item))} />
              <input aria-label="Weight kg" inputMode="decimal" type="number" min={0.1} max={2000} step={0.1} className="rounded-xl border border-line px-2 py-2" value={row.weightKg} onChange={(event) => setPalletRows(palletRows.map((item, itemIndex) => itemIndex === index ? { ...item, weightKg: event.currentTarget.value } : item))} />
              {index > 0 ? <button type="button" className="rounded-xl border border-line px-2 py-2 text-sm font-semibold" onClick={() => setPalletRows(palletRows.filter((_, itemIndex) => itemIndex !== index))}>Remove</button> : <span />}
            </div>
          ))}
          <button type="button" className="rounded-xl border border-line px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={palletRows.length >= 30} onClick={() => setPalletRows([...palletRows, emptyPallet()])}>Add pallet</button>
        </div>
        <button type="button" onClick={() => void lookup()} disabled={!numbers.trim() || working !== null} className="rounded-xl bg-red px-4 py-2 font-semibold text-white disabled:opacity-50">
          {working === "lookup" ? "Retrieving orders…" : "Retrieve orders"}
        </button>
      </section>
      {error ? (
        <section role="alert" className="rounded-xl border border-red-300 p-4">
          <p className="font-semibold">{error}</p>
          {details.length ? <ul className="mt-2 list-disc pl-5 text-sm">{details.map((item) => <li key={item}>{item}</li>)}</ul> : null}
        </section>
      ) : null}
      {!draft && !error ? <p>No orders yet.</p> : null}
      {draft ? (
        <section className="space-y-4 rounded-3xl border border-line bg-card p-5">
          <h2 className="text-lg font-semibold">Invoice</h2>
          <p className="text-sm">{draft.buyer.name}</p>
          <p className="text-sm">{draft.buyer.address}</p>
          <p className="text-sm">{draft.currency} · {draft.destinationCountry}</p>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm font-semibold">Incoterm
              <select className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={draft.incoterm} onChange={(event) => setDraft({ ...draft, incoterm: event.currentTarget.value })}>
                {TERMS.map((term) => <option key={term}>{term}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold">Named place
              <input className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={draft.namedPlace} onChange={(event) => setDraft({ ...draft, namedPlace: event.currentTarget.value })} />
            </label>
            {draft.incoterm === "DDP" ? (
              <>
                <label className="text-sm font-semibold">Importer name
                  <input className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={draft.importer.name} onChange={(event) => setDraft({ ...draft, importer: { ...draft.importer, name: event.currentTarget.value } })} />
                </label>
                <label className="text-sm font-semibold md:col-span-2">Importer address
                  <textarea rows={2} className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={draft.importer.address} onChange={(event) => setDraft({ ...draft, importer: { ...draft.importer, address: event.currentTarget.value } })} />
                </label>
                <label className="text-sm font-semibold">Importer VAT
                  <input className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={draft.importer.vat} onChange={(event) => setDraft({ ...draft, importer: { ...draft.importer, vat: event.currentTarget.value } })} />
                </label>
                <label className="text-sm font-semibold">Importer EORI
                  <input className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={draft.importer.eori} onChange={(event) => setDraft({ ...draft, importer: { ...draft.importer, eori: event.currentTarget.value } })} />
                </label>
                <label className="text-sm font-semibold">Clearance country
                  <input maxLength={2} className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={draft.clearanceCountry} onChange={(event) => setDraft({ ...draft, clearanceCountry: event.currentTarget.value.toUpperCase() })} />
                </label>
                <label className="text-sm font-semibold">Customs procedure
                  <select className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={draft.procedure} onChange={(event) => setDraft({ ...draft, procedure: event.currentTarget.value as InvoiceDraft["procedure"] })}>
                    <option value="unconfirmed">Unconfirmed</option>
                    <option value="40">40</option>
                    <option value="42">42</option>
                    <option value="transit">Transit</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="text-sm font-semibold">DDP model
                  <select className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={draft.ddpModel} onChange={(event) => setDraft({ ...draft, ddpModel: event.currentTarget.value as InvoiceDraft["ddpModel"] })}>
                    <option value="not_applicable">Not applicable</option>
                    <option value="unspecified">Unspecified</option>
                    <option value="importers_signature">Importer signature</option>
                    <option value="own_french_vat">Own French VAT</option>
                  </select>
                </label>
                {draft.ddpModel === "own_french_vat" ? (
                  <label className="text-sm font-semibold">French VAT
                    <input className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={draft.frenchVatNumber} onChange={(event) => setDraft({ ...draft, frenchVatNumber: event.currentTarget.value })} />
                  </label>
                ) : null}
                {draft.procedure === "42" || draft.procedure === "other" ? (
                  <label className="text-sm font-semibold">Statement reviewer
                    <input className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={draft.statementApprovedBy} onChange={(event) => setDraft({ ...draft, statementApprovedBy: event.currentTarget.value })} />
                  </label>
                ) : null}
              </>
            ) : null}
            <label className="text-sm font-semibold">Buyer VAT
              <input className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={draft.buyer.vat} onChange={(event) => setDraft({ ...draft, buyer: { ...draft.buyer, vat: event.currentTarget.value } })} />
            </label>
            <label className="text-sm font-semibold">Buyer EORI
              <input className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={draft.buyer.eori} onChange={(event) => setDraft({ ...draft, buyer: { ...draft.buyer, eori: event.currentTarget.value } })} />
            </label>
            <label className="text-sm font-semibold">FAO
              <input className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={shipment?.fao ?? ""} onChange={(event) => patchShipment({ fao: event.currentTarget.value })} />
            </label>
            <label className="text-sm font-semibold">Courier
              <input className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={shipment?.courier ?? ""} onChange={(event) => patchShipment({ courier: event.currentTarget.value })} />
            </label>
            <label className="text-sm font-semibold">Despatch date
              <input type="date" className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={shipment?.despatchDate ?? ""} onChange={(event) => patchShipment({ despatchDate: event.currentTarget.value })} />
            </label>
            <label className="text-sm font-semibold md:col-span-3">Delivery address
              <textarea rows={3} className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={shipment?.deliveryAddress ?? ""} onChange={(event) => patchShipment({ deliveryAddress: event.currentTarget.value })} />
            </label>
            <label className="text-sm font-semibold">Contact
              <input className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={shipment?.contactName ?? ""} onChange={(event) => patchShipment({ contactName: event.currentTarget.value })} />
            </label>
            <label className="text-sm font-semibold">Email
              <input className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={shipment?.contactEmail ?? ""} onChange={(event) => patchShipment({ contactEmail: event.currentTarget.value })} />
            </label>
            <label className="text-sm font-semibold">Parcels
              <input type="number" min={0} max={999} className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={shipment?.parcels ?? 0} onChange={(event) => patchShipment({ parcels: Number(event.currentTarget.value) })} />
            </label>
            <p className="text-sm font-semibold">Gross {gross.toFixed(1)} kg</p>
            <label className="text-sm font-semibold">Delivery
              <input type="number" min={0} max={1000000} step="0.01" className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={((shipment?.deliveryPence ?? 0) / 100).toFixed(2)} onChange={(event) => patchShipment({ deliveryPence: Math.round(Number(event.currentTarget.value) * 100) })} />
            </label>
            <label className="text-sm font-semibold">Surcharge
              <input type="number" min={0} max={1000000} step="0.01" className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={((shipment?.surchargePence ?? 0) / 100).toFixed(2)} onChange={(event) => patchShipment({ surchargePence: Math.round(Number(event.currentTarget.value) * 100) })} />
            </label>
            <label className="text-sm font-semibold">VAT
              <input type="number" min={0} max={1000000} step="0.01" className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={((shipment?.vatPence ?? 0) / 100).toFixed(2)} onChange={(event) => patchShipment({ vatPence: Math.round(Number(event.currentTarget.value) * 100) })} />
            </label>
            <label className="text-sm font-semibold">Customs statement
              <select className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={shipment?.customsStatementId ?? "matched"} onChange={(event) => patchShipment({ customsStatementId: event.currentTarget.value })}>
                <option value="matched">Suggested</option>
                {CUSTOMS_STATEMENTS.filter((item) => item.id !== "none").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                <option value="none">None</option>
              </select>
            </label>
            {shipment?.customsStatementId === "matched" ? <p className="text-sm md:col-span-2">{suggested || "None"}</p> : null}
            {shipment?.customsStatementId === "custom" ? (
              <label className="text-sm font-semibold md:col-span-2">Statement
                <textarea rows={3} className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={shipment.customsStatementText} onChange={(event) => patchShipment({ customsStatementText: event.currentTarget.value })} />
              </label>
            ) : null}
            <p className="text-sm font-semibold md:col-span-3">Special instructions</p>
            <p className="text-sm md:col-span-3">{shipment?.specialInstructions || "None"}</p>
          </div>
          <div className="space-y-3">
            {draft.lines.map((line) => (
              <div key={line.id} className="grid gap-3 rounded-xl border border-line p-3 md:grid-cols-4">
                <p className="font-semibold md:col-span-4">{line.orderNumber} · {line.sku} — {line.productName}</p>
                <label className="text-sm font-semibold">
                  <span className="flex items-baseline justify-between gap-2">Shipped qty <span className="text-xs font-normal opacity-70">of {line.orderedQuantity} ordered</span></span>
                  <input type="number" min={0} className="mt-1 w-full rounded-xl border border-line px-3 py-2" value={line.shippedQuantity} onChange={(event) => setDraft({ ...draft, lines: draft.lines.map((item) => item.id === line.id ? { ...item, shippedQuantity: Number(event.currentTarget.value) } : item) })} />
                </label>
                <label className="text-sm font-semibold">HS code
                  <input className="mt-1 w-full rounded-xl border border-line px-3 py-2" value={line.hsCode} onChange={(event) => setDraft({ ...draft, lines: draft.lines.map((item) => item.id === line.id ? { ...item, hsCode: event.currentTarget.value } : item) })} />
                </label>
                <label className="text-sm font-semibold">Origin
                  <input className="mt-1 w-full rounded-xl border border-line px-3 py-2" value={line.originCountry} onChange={(event) => setDraft({ ...draft, lines: draft.lines.map((item) => item.id === line.id ? { ...item, originCountry: event.currentTarget.value.toUpperCase() } : item) })} />
                </label>
                <label className="text-sm font-semibold">Unit kg
                  <input type="number" min={0} className="mt-1 w-full rounded-xl border border-line px-3 py-2" value={line.unitWeightKg ?? ""} onChange={(event) => setDraft({ ...draft, lines: draft.lines.map((item) => item.id === line.id ? { ...item, unitWeightKg: event.currentTarget.value === "" ? null : Number(event.currentTarget.value) } : item) })} />
                </label>
              </div>
            ))}
          </div>
          <p className="text-sm font-semibold">Goods {goodsTotal({ ...draft, netWeightKg: net }).toFixed(2)} {draft.currency} · Net {net.toFixed(3)} kg</p>
          {issued ? <p className="font-semibold">{issued}</p> : null}
          <div className="flex gap-3">
            <button type="button" onClick={() => void preview()} disabled={working !== null} className="rounded-xl border border-line px-4 py-2 font-semibold disabled:opacity-50">Preview</button>
            <button type="button" onClick={() => void issue()} disabled={working !== null} className="rounded-xl bg-red px-4 py-2 font-semibold text-white disabled:opacity-50">Issue</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
