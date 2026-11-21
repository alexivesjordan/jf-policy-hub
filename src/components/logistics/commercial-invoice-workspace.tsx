"use client";

import { useRef, useState } from "react";
import { commercialInvoiceFileName } from "@/features/logistics/commercial-invoice/filename";
import { goodsTotal, summedNetWeightKg, type InvoiceDraft, type InvoiceOrder } from "@/features/logistics/commercial-invoice/rules";

const TERMS = ["DAP", "DDP", "EXW", "FCA", "CPT", "CIP", "DPU", "FOB", "CIF"];

export function CommercialInvoiceWorkspace() {
  const [numbers, setNumbers] = useState("");
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const [working, setWorking] = useState<"lookup" | "preview" | "issue" | null>(null);
  const [error, setError] = useState("");
  const [details, setDetails] = useState<string[]>([]);
  const [issued, setIssued] = useState("");

  async function lookup() {
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
      });
    } catch (err) {
      setDraft(null);
      setError(err instanceof Error ? err.message : "Order lookup failed.");
    } finally {
      setWorking(null);
    }
  }

  function payload() {
    if (!draft) return null;
    return {
      orderNumbers: draft.orders,
      incoterm: draft.incoterm,
      namedPlace: draft.namedPlace,
      destinationCountry: draft.destinationCountry,
      packages: draft.packages,
      packageType: draft.packageType,
      grossWeightKg: draft.grossWeightKg,
      buyerVat: draft.buyer.vat,
      buyerEori: draft.buyer.eori,
      lines: draft.lines.map((line) => ({
        lineId: line.id,
        orderNumber: line.orderNumber,
        sku: line.sku,
        shippedQuantity: line.shippedQuantity,
        hsCode: line.hsCode,
        originCountry: line.originCountry,
        unitWeightKg: line.unitWeightKg,
      })),
    };
  }

  async function preview() {
    const body = payload();
    if (!body || !draft) return;
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

  const net = draft ? summedNetWeightKg(draft.lines) : 0;
  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-3xl border border-line bg-card p-5">
        <h2 className="text-lg font-semibold">Orders</h2>
        <label className="block text-sm font-semibold" htmlFor="invoice-orders">Order numbers</label>
        <textarea id="invoice-orders" rows={2} value={numbers} onChange={(event) => setNumbers(event.currentTarget.value)} className="w-full rounded-xl border border-line bg-paper p-3" />
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
            <label className="text-sm font-semibold">Buyer VAT
              <input className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={draft.buyer.vat} onChange={(event) => setDraft({ ...draft, buyer: { ...draft.buyer, vat: event.currentTarget.value } })} />
            </label>
            <label className="text-sm font-semibold">Packages
              <input type="number" min={1} className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={draft.packages} onChange={(event) => setDraft({ ...draft, packages: Number(event.currentTarget.value) })} />
            </label>
            <label className="text-sm font-semibold">Package type
              <input className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={draft.packageType} onChange={(event) => setDraft({ ...draft, packageType: event.currentTarget.value })} />
            </label>
            <label className="text-sm font-semibold">Gross kg
              <input type="number" min={0} className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2" value={draft.grossWeightKg} onChange={(event) => setDraft({ ...draft, grossWeightKg: Number(event.currentTarget.value) })} />
            </label>
          </div>
          <div className="space-y-3">
            {draft.lines.map((line) => (
              <div key={line.id} className="grid gap-3 rounded-xl border border-line p-3 md:grid-cols-4">
                <p className="font-semibold md:col-span-4">{line.orderNumber} · {line.sku} — {line.productName}</p>
                <label className="text-sm font-semibold">Shipped qty
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
