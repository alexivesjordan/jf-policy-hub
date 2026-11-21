"use client";

import { useState } from "react";
import {
  mergeInvoiceOrders, validateCommercialInvoice, goodsTotal, declaredTotal,
  type InvoiceDraft, type InvoiceParty, type InvoiceOrder,
} from "@/features/logistics/commercial-invoice/rules";

const SELLER: InvoiceParty = {
  name: "Jordan Fitness Ltd",
  address: "56 Oldmedow Road, Hardwick Industrial Estate, King's Lynn, Norfolk, PE30 4JJ, United Kingdom",
  vat: "GB385438070", eori: "GB385438070001",
};
const TERMS = ["", "EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP", "FAS", "FOB", "CFR", "CIF"];
type PartyName = "seller" | "buyer" | "consignee" | "importer";

function InputField({
  label, value, onChange, type = "text", hint = "", min,
}: {
  label: string; value: string | number; onChange: (value: string) => void;
  type?: string; hint?: string; min?: number;
}) {
  return <label className="flex flex-col gap-1 text-sm">
    <span className="font-semibold">{label}</span>
    <input className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-ink"
      type={type} min={min} value={value} onChange={e => onChange(e.currentTarget.value)} />
    {hint ? <span className="text-xs text-grey">{hint}</span> : null}
  </label>;
}
function SelectField({ label, value, options, onChange }: {
  label: string; value: string; options: [string, string][];
  onChange: (value: string) => void;
}) {
  return <label className="flex flex-col gap-1 text-sm">
    <span className="font-semibold">{label}</span>
    <select className="w-full rounded-xl border border-line bg-paper px-3 py-2" value={value}
      onChange={e => onChange(e.currentTarget.value)}>
      {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </select>
  </label>;
}
const countriesHint = "Use 2-letter ISO code (e.g. GB, IE, NL, CH, FR).";
const option = (v: string) => [v, v] as [string,string];

export function CommercialInvoiceWorkspace() {
  const [numbers, setNumbers] = useState("");
  const [source, setSource] = useState<InvoiceOrder[]>([]);
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [working, setWorking] = useState<"lookup" | "preview" | null>(null);
  const [error, setError] = useState("");
  const [details, setDetails] = useState<string[]>([]);

  const update = <K extends keyof InvoiceDraft>(key: K, value: InvoiceDraft[K]) =>
    setDraft(current => current ? { ...current, [key]: value } : null);
  const changeParty = (party: PartyName, field: keyof InvoiceParty, value: string) =>
    setDraft(current => current ? {
      ...current, [party]: { ...current[party], [field]: value },
    } : null);
  const setLine = (id: string, field: keyof InvoiceDraft["lines"][number], value: string | number) =>
    setDraft(current => current ? {
      ...current, lines: current.lines.map(line => line.id === id ? { ...line, [field]: value } : line),
    } : null);
  async function lookup() {
    setError(""); setDetails([]);setWorking("lookup");setDraft(null);setSource([]);
    try {
      const res = await fetch("/api/logistics/commercial-invoices/lookup", {
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderNumbers:numbers}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Cin7 lookup failed.");
      const orders = json.orders as InvoiceOrder[];
      const combined = mergeInvoiceOrders(orders, SELLER);
      setSource(orders);setDraft(combined);
    } catch (err) {setError(err instanceof Error ? err.message : "Order lookup failed.");}
    finally {setWorking(null);}
  }
  async function preview() {
    if (!draft) return;
    const problems = validateCommercialInvoice(draft);
    if (problems.length) { setDetails(problems);setError("Resolve the issues below before previewing the invoice.");return; }
    setWorking("preview");setError("");setDetails([]);
    try {
      const res = await fetch("/api/logistics/commercial-invoices/preview",{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(draft),
      });
      if (!res.ok) {
        const json = await res.json();
        setDetails(Array.isArray(json.details) ? json.details : []);
        throw new Error(json.error || "The PDF could not be generated.");
      }
      const url = URL.createObjectURL(await res.blob());
      const anchor=document.createElement("a");
      anchor.href=url;anchor.download="commercial-invoice-PREVIEW.pdf";
      document.body.appendChild(anchor);anchor.click();anchor.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),30000);
    } catch (err) {setError(err instanceof Error ? err.message : "PDF generation failed.");}
    finally {setWorking(null);}
  }
  function partyFields(party: PartyName, label: string) {
    if (!draft) return null;
    const p = draft[party];
    return <fieldset className="rounded-2xl border border-line p-4">
      <legend className="px-1 font-semibold">{label}</legend>
      <div className="grid gap-3 md:grid-cols-2">
        <InputField label="Legal name" value={p.name} onChange={v=>changeParty(party,"name",v)}/>
        <InputField label="VAT number" value={p.vat} onChange={v=>changeParty(party,"vat",v)}/>
        <InputField label="EORI number" value={p.eori} onChange={v=>changeParty(party,"eori",v)}/>
        <label className="flex flex-col gap-1 text-sm"><span className="font-semibold">Address</span>
          <textarea rows={3} className="w-full rounded-xl border border-line bg-paper p-2"
            value={p.address} onChange={e=>changeParty(party,"address",e.currentTarget.value)}/>
        </label>
      </div>
    </fieldset>;
  }
  const num = (value: string) => value.trim() === "" ? 0 : Number(value);
  return <div className="space-y-6">
    <section className="rounded-3xl border border-line bg-card p-5 space-y-3">
      <h2 className="text-lg font-semibold">Look up Cin7 orders</h2>
      <p className="text-sm text-grey">Enter up to ten order numbers separated by spaces, commas or new lines. No Cin7 records will be changed.</p>
      <label className="block text-sm font-semibold" htmlFor="invoice-orders">Order numbers</label>
      <textarea id="invoice-orders" rows={2} value={numbers} onChange={e=>setNumbers(e.currentTarget.value)}
        placeholder="SO-00563, SO-00643" className="w-full rounded-xl border border-line bg-paper p-3" />
      <button type="button" onClick={lookup} disabled={!numbers.trim() || working !== null}
        className="rounded-xl bg-red px-4 py-2 font-semibold text-white disabled:opacity-50">
        {working==="lookup" ? "Retrieving orders…" : "Retrieve orders"}
      </button>
    </section>
    {error ? <section role="alert" className="rounded-xl border border-red-300 p-4">
      <p className="font-semibold">{error}</p>
      {details.length ? <ul className="mt-2 list-disc pl-5 text-sm">{details.map((d,i)=><li key={i}>{d}</li>)}</ul> : null}
    </section> : null}
    {draft ? <>
      <section className="rounded-3xl border border-line bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Invoice details</h2>
        <p className="text-sm text-grey">This is a draft. Confirm the legal parties, currency, shipped quantities and customs particulars from your carrier/broker records. Pulse does not guess missing fields.</p>
        {source.flatMap(o=>o.warnings.map((w,i)=><p className="text-xs text-grey" key={o.id+"-"+i}>{o.orderNumber}: {w}</p>))}
        <div className="grid gap-3 md:grid-cols-3">
          <InputField label="Document reference" value={draft.reference} onChange={v=>update("reference",v)}/>
          <InputField label="Invoice date" type="date" value={draft.issueDate} onChange={v=>update("issueDate",v)}/>
          <InputField label="Currency" value={draft.currency} onChange={v=>update("currency",v.toUpperCase())} hint="Three-letter currency, verified against Cin7"/>
        </div>
        {partyFields("seller","Exporter")}
        {partyFields("buyer","Buyer")}
        {partyFields("consignee","Consignee")}
        {draft.incoterm==="DDP" ? partyFields("importer","Importer of record (DDP)") : null}
      </section>
      <section className="rounded-3xl border border-line bg-card p-5 space-y-4">
        <h2 className="text-lg font-semibold">Shipping and customs</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <SelectField label="Carrier" value={draft.carrier} options={["Other","Europa","FedEx","Collection"].map(option)}
            onChange={v=>update("carrier",v as InvoiceDraft["carrier"])}/>
          <SelectField label="Incoterm" value={draft.incoterm} options={TERMS.map(v=>[v,v||"Select"])} onChange={v=>update("incoterm",v)}/>
          <InputField label="Named Incoterm place" value={draft.namedPlace} onChange={v=>update("namedPlace",v)}/>
          <InputField label="Destination country" value={draft.destinationCountry} hint={countriesHint}
            onChange={v=>update("destinationCountry",v.toUpperCase())}/>
          <InputField label="EU entry country, if relevant" value={draft.entryCountry} hint={countriesHint}
            onChange={v=>update("entryCountry",v.toUpperCase())}/>
          <InputField label="Customs clearance country, if known" value={draft.clearanceCountry} hint={countriesHint}
            onChange={v=>update("clearanceCountry",v.toUpperCase())}/>
          <SelectField label="Customs procedure" value={draft.procedure}
            options={[["unconfirmed","Unconfirmed"],["40","40 - free circulation"],["42","42 - qualifying onward EU movement"],["transit","Transit"],["other","Other"]]}
            onChange={v=>update("procedure",v as InvoiceDraft["procedure"])}/>
          <SelectField label="Europa French DDP model, if relevant" value={draft.ddpModel}
            options={[["not_applicable","Not applicable"],["unspecified","Not yet confirmed"],["importers_signature","Importer's signature"],["own_french_vat","Own French VAT"]]}
            onChange={v=>update("ddpModel",v as InvoiceDraft["ddpModel"])}/>
          <InputField label="Shipment/carrier reference" value={draft.shipmentRef} onChange={v=>update("shipmentRef",v)}/>
          <InputField label="Jordan French VAT, if relevant" value={draft.frenchVatNumber} onChange={v=>update("frenchVatNumber",v)}/>
          <InputField label="French representative VAT, if relevant" value={draft.frenchFiscalRepresentativeVat} onChange={v=>update("frenchFiscalRepresentativeVat",v)}/>
          <InputField label="Reason for export" value={draft.reasonForExport} onChange={v=>update("reasonForExport",v)}/>
        </div>
        <label className="flex flex-col gap-1 text-sm"><span className="font-semibold">Customs-approved statement (if applicable)</span>
          <textarea rows={3} className="rounded-xl border border-line bg-paper p-3" value={draft.approvedStatement}
            onChange={e=>update("approvedStatement",e.currentTarget.value)}/>
        </label>
        <InputField label="Statement approved by" value={draft.statementApprovedBy} onChange={v=>update("statementApprovedBy",v)} />
        <p className="text-xs text-grey">No customs statement is automatically selected. Use only wording confirmed for this shipment by the customs broker.</p>
      </section>
      <section className="rounded-3xl border border-line bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Goods in this consignment</h2>
        <p className="text-sm text-grey">SKU and product name only, not website descriptions. Quantities default to the Cin7 order and MUST be checked against the physical shipment.</p>
        <div className="space-y-3">
          {draft.lines.map(line=><div key={line.id} className="rounded-xl border border-line p-3 space-y-2">
            <p className="font-semibold">{line.orderNumber} · {line.sku} — {line.productName}</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <InputField label={"Shipped qty (ordered "+line.orderedQuantity+")"} type="number" min={0}
                value={line.shippedQuantity} onChange={v=>setLine(line.id,"shippedQuantity",num(v))}/>
              <InputField label={"Unit net value ("+draft.currency+")"} type="number" min={0}
                value={line.unitNetValue} onChange={v=>setLine(line.id,"unitNetValue",num(v))}/>
              <InputField label="Commodity code" value={line.hsCode} onChange={v=>setLine(line.id,"hsCode",v)}/>
              <InputField label="Origin country ISO code" value={line.originCountry}
                onChange={v=>setLine(line.id,"originCountry",v.toUpperCase())}/>
            </div>
          </div>)}
        </div>
      </section>
      <section className="rounded-3xl border border-line bg-card p-5 space-y-4">
        <h2 className="text-lg font-semibold">Packing, totals and review</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <InputField label="Number of packages" type="number" min={0} value={draft.packages} onChange={v=>update("packages",num(v))}/>
          <InputField label="Package type" value={draft.packageType} onChange={v=>update("packageType",v)}/>
          <InputField label="Net kg" type="number" min={0} value={draft.netWeightKg} onChange={v=>update("netWeightKg",num(v))}/>
          <InputField label="Gross kg" type="number" min={0} value={draft.grossWeightKg} onChange={v=>update("grossWeightKg",num(v))}/>
          <InputField label="Freight" type="number" min={0} value={draft.freightValue} onChange={v=>update("freightValue",num(v))}/>
          <InputField label="Insurance" type="number" min={0} value={draft.insuranceValue} onChange={v=>update("insuranceValue",num(v))}/>
          <InputField label="Other charges" type="number" min={0} value={draft.otherChargesValue} onChange={v=>update("otherChargesValue",num(v))}/>
          <InputField label="Authorised signatory" value={draft.signatory} onChange={v=>update("signatory",v)}/>
        </div>
        <label className="flex flex-col gap-1 text-sm"><span className="font-semibold">Notes</span>
          <textarea rows={2} className="rounded-xl border border-line bg-paper p-3" value={draft.notes}
            onChange={e=>update("notes",e.currentTarget.value)}/>
        </label>
        <p className="text-sm font-semibold">Goods: {goodsTotal(draft).toFixed(2)} {draft.currency} · Declared total: {declaredTotal(draft).toFixed(2)} {draft.currency}</p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={draft.physicalShipmentConfirmed}
            onChange={e=>update("physicalShipmentConfirmed",e.currentTarget.checked)}/>
          I have verified the quantities, descriptions and weights against the actual consignment.
        </label>
        <button type="button" onClick={preview} disabled={working!==null}
          className="rounded-xl bg-red px-4 py-2 font-semibold text-white disabled:opacity-50">
          {working==="preview" ? "Generating preview…" : "Download validated PDF preview"}
        </button>
        <p className="text-xs text-grey">Preview only. This pilot does not allocate an issued invoice number, archive a signed PDF, transmit to a carrier, or submit a customs declaration.</p>
      </section>
    </> : null}
  </div>;
}
