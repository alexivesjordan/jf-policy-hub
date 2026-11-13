"use client";

import { useState, type ReactNode } from "react";
import { PhotoPicker, type StoredPhoto } from "@/components/field/photo-picker";
import { SignaturePad } from "@/components/field/signature-pad";
import { Choice, YesNo } from "@/components/field/yes-no";
import { Input, TextArea } from "@/components/pulse/ui";
import { createSubcontractorLink, saveVisitRisk, submitVisit } from "@/features/field/actions";
import { FORM_NOTICES, RISK_ITEMS, blankLine, blankPart, emptyRisk, type OrderLineView, type RiskAnswers, type SheetDraft } from "@/lib/installs/visit-form";

export type VisitScreen = {
  installId: string;
  token: string | null;
  canInvite: boolean;
  customerName: string;
  siteAddress: string | null;
  contactName: string;
  phone: string;
  address: string;
  orderNo: string;
  startOn: string;
  lines: OrderLineView[];
  risk: RiskAnswers | null;
  submitted: boolean;
  engineerName: string;
  signatureUrl: string | null;
  signatureFileId: string | null;
};

const steps = ["Risk", "Sheet", "Photos", "Sign"];

function draftFrom(screen: VisitScreen): SheetDraft {
  const lines = screen.lines.filter((line) => line.sku || line.description);
  return {
    visitType: "install",
    sheetOn: screen.startOn || "",
    returnedOn: "",
    contactName: screen.contactName,
    address: screen.address,
    phone: screen.phone,
    orderNo: screen.orderNo,
    jobNo: screen.orderNo,
    serviceContract: null,
    callOutCharge: null,
    timeOn: "",
    timeOff: "",
    overnightStay: null,
    parkingFee: "",
    service: false,
    delivery: false,
    installation: true,
    warranty: false,
    ladderCheck: false,
    lines: lines.length > 0 ? lines.map((line) => ({ code: line.sku, description: line.description, reportedJob: "" })) : [blankLine()],
    workCarriedOut: "",
    parts: [blankPart()],
    locationOk: null,
    fixingWall: null,
    fixingFloor: null,
    workOk: null,
    siteOk: null,
    engineerName: screen.engineerName,
    vehicleReg: "",
    customerName: screen.customerName,
  };
}

export function VisitFlow({ screen }: { screen: VisitScreen }) {
  const [step, setStep] = useState(screen.risk ? 1 : 0);
  const [risk, setRisk] = useState<RiskAnswers>(screen.risk ?? emptyRisk());
  const [concerns, setConcerns] = useState<StoredPhoto[]>([]);
  const [sheet, setSheet] = useState<SheetDraft>(() => draftFrom(screen));
  const [photos, setPhotos] = useState<StoredPhoto[]>([]);
  const [engineerBlob, setEngineerBlob] = useState<Blob | null>(null);
  const [drawEngineer, setDrawEngineer] = useState(!screen.signatureUrl);
  const [customerBlob, setCustomerBlob] = useState<Blob | null>(null);
  const [keepSignature, setKeepSignature] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(screen.submitted);
  const [link, setLink] = useState<string | null>(null);

  function patch(partial: Partial<SheetDraft>) {
    setSheet((current) => ({ ...current, ...partial }));
  }

  async function saveRisk() {
    setPending(true);
    setMessage(null);
    const result = await saveVisitRisk(screen.installId, screen.token, risk, concerns.map((photo) => photo.id));
    setPending(false);
    setOk(result.ok);
    setMessage(result.message);
    if (result.ok) setStep(1);
  }

  async function finish() {
    setPending(true);
    setMessage(null);
    const body = new FormData();
    body.set("installId", screen.installId);
    if (screen.token) body.set("token", screen.token);
    body.set("sheet", JSON.stringify(sheet));
    body.set("photoIds", JSON.stringify(photos.map((photo) => photo.id)));
    if (engineerBlob) body.set("engineerSignature", new File([engineerBlob], "engineer.png", { type: "image/png" }));
    else if (screen.signatureFileId) body.set("engineerSignatureFileId", screen.signatureFileId);
    if (customerBlob) body.set("customerSignature", new File([customerBlob], "customer.png", { type: "image/png" }));
    if (keepSignature) body.set("saveSignature", "yes");
    const result = await submitVisit(body);
    setPending(false);
    setOk(result.ok);
    setMessage(result.message);
    if (result.ok) setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-4">
        <h2 className="font-display text-3xl">Job sheet in</h2>
        <p className="text-base">{message ?? `${screen.customerName} is marked completed.`}</p>
        {screen.canInvite ? <Invite installId={screen.installId} link={link} onLink={setLink} /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8">
      <p className="text-sm font-semibold text-grey">
        {screen.customerName}
        {screen.siteAddress ? ` · ${screen.siteAddress}` : ""}
      </p>
      <ol className="grid grid-cols-4 gap-2">
        {steps.map((label, index) => (
          <li key={label}>
            <button
              type="button"
              className={`min-h-12 w-full rounded-2xl border text-sm font-semibold ${index === step ? "border-red bg-red text-white" : "border-line bg-card text-ink"}`}
              onClick={() => {
                if (index === 0 || screen.risk || risk.accessClear != null) setStep(index);
              }}
            >
              {label}
            </button>
          </li>
        ))}
      </ol>
      {message ? <p className={`text-sm font-semibold ${ok ? "text-ink" : "text-red"}`}>{message}</p> : null}
      {step === 0 ? (
        <section className="space-y-4">
          <h2 className="font-display text-3xl">Before you start</h2>
          {RISK_ITEMS.map((item) => (
            <YesNo key={item.key} label={item.label} value={risk[item.key]} onChange={(next) => setRisk((current) => ({ ...current, [item.key]: next }))} />
          ))}
          <label className="block space-y-2 text-sm font-semibold">
            Notes
            <TextArea value={risk.notes} onChange={(event) => setRisk((current) => ({ ...current, notes: event.target.value }))} />
          </label>
          <PhotoPicker installId={screen.installId} token={screen.token} kind="concern" photos={concerns} onChange={setConcerns} max={6} label="Photo of a concern" />
          <button type="button" disabled={pending} onClick={() => void saveRisk()} className="min-h-14 w-full rounded-full bg-red text-base font-semibold text-white disabled:opacity-60">
            {pending ? "Saving" : "Save and continue"}
          </button>
        </section>
      ) : null}
      {step === 1 ? <SheetStep sheet={sheet} patch={patch} onNext={() => setStep(2)} /> : null}
      {step === 2 ? (
        <section className="space-y-4">
          <h2 className="font-display text-3xl">Equipment</h2>
          <PhotoPicker installId={screen.installId} token={screen.token} kind="equipment" photos={photos} onChange={setPhotos} label="Add photos" />
          <button type="button" onClick={() => setStep(3)} className="min-h-14 w-full rounded-full bg-red text-base font-semibold text-white">
            Signatures
          </button>
        </section>
      ) : null}
      {step === 3 ? (
        <section className="space-y-4">
          <h2 className="font-display text-3xl">Sign</h2>
          <label className="block space-y-2 text-sm font-semibold">
            Engineer
            <Input value={sheet.engineerName} onChange={(event) => patch({ engineerName: event.target.value })} />
          </label>
          <label className="block space-y-2 text-sm font-semibold">
            Vehicle reg
            <Input value={sheet.vehicleReg} autoCapitalize="characters" onChange={(event) => patch({ vehicleReg: event.target.value })} />
          </label>
          {screen.signatureUrl && !drawEngineer ? (
            <div className="space-y-2">
              <div role="img" aria-label="Saved engineer signature" className="h-32 w-full rounded-2xl border border-line bg-white bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url("${screen.signatureUrl}")` }} />
              <button type="button" className="min-h-12 text-base font-semibold underline decoration-red" onClick={() => setDrawEngineer(true)}>
                Sign again
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Engineer signature</p>
              <SignaturePad onChange={setEngineerBlob} />
              {!screen.token && engineerBlob ? (
                <label className="flex min-h-12 items-center gap-3 text-base">
                  <input type="checkbox" className="size-5" checked={keepSignature} onChange={(event) => setKeepSignature(event.target.checked)} />
                  Save on my profile
                </label>
              ) : null}
            </div>
          )}
          <label className="block space-y-2 text-sm font-semibold">
            Customer name
            <Input value={sheet.customerName} onChange={(event) => patch({ customerName: event.target.value })} />
          </label>
          <p className="text-sm font-semibold">{FORM_NOTICES.signing}</p>
          <SignaturePad onChange={setCustomerBlob} />
          <p className="text-sm text-grey">{FORM_NOTICES.hours}</p>
          <button type="button" disabled={pending} onClick={() => void finish()} className="min-h-14 w-full rounded-full bg-red text-base font-semibold text-white disabled:opacity-60">
            {pending ? "Sending" : "Submit"}
          </button>
        </section>
      ) : null}
      {screen.canInvite && step === 0 ? <Invite installId={screen.installId} link={link} onLink={setLink} /> : null}
    </div>
  );
}

function SheetStep({ sheet, patch, onNext }: { sheet: SheetDraft; patch: (partial: Partial<SheetDraft>) => void; onNext: () => void }) {
  function setLine(index: number, partial: Partial<SheetDraft["lines"][number]>) {
    patch({ lines: sheet.lines.map((line, item) => (item === index ? { ...line, ...partial } : line)) });
  }
  function setPart(index: number, partial: Partial<SheetDraft["parts"][number]>) {
    patch({ parts: sheet.parts.map((part, item) => (item === index ? { ...part, ...partial } : part)) });
  }
  return (
    <section className="space-y-4">
      <h2 className="font-display text-3xl">Job sheet</h2>
      <div className="grid grid-cols-2 gap-2">
        <Choice label="Install" selected={sheet.visitType === "install"} onClick={() => patch({ visitType: "install", installation: true, service: false })} />
        <Choice label="Service" selected={sheet.visitType === "service"} onClick={() => patch({ visitType: "service", installation: false, service: true })} />
      </div>
      <Field label="Date"><Input type="date" value={sheet.sheetOn} onChange={(event) => patch({ sheetOn: event.target.value })} /></Field>
      <Field label="Date returned"><Input type="date" value={sheet.returnedOn} onChange={(event) => patch({ returnedOn: event.target.value })} /></Field>
      <Field label="Contact name"><Input value={sheet.contactName} onChange={(event) => patch({ contactName: event.target.value })} /></Field>
      <Field label="Address"><TextArea value={sheet.address} onChange={(event) => patch({ address: event.target.value })} /></Field>
      <Field label="Telephone"><Input inputMode="tel" value={sheet.phone} onChange={(event) => patch({ phone: event.target.value })} /></Field>
      <Field label="Order no."><Input value={sheet.orderNo} onChange={(event) => patch({ orderNo: event.target.value })} /></Field>
      <Field label="Job no."><Input value={sheet.jobNo} onChange={(event) => patch({ jobNo: event.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Time on site"><Input type="time" value={sheet.timeOn} onChange={(event) => patch({ timeOn: event.target.value })} /></Field>
        <Field label="Time off site"><Input type="time" value={sheet.timeOff} onChange={(event) => patch({ timeOff: event.target.value })} /></Field>
      </div>
      <YesNo label="Service contract" value={sheet.serviceContract} onChange={(next) => patch({ serviceContract: next })} />
      <YesNo label="Call out charge" value={sheet.callOutCharge} onChange={(next) => patch({ callOutCharge: next })} />
      <YesNo label="Overnight stay" value={sheet.overnightStay} onChange={(next) => patch({ overnightStay: next })} />
      <Field label="Parking fee (£)"><Input inputMode="decimal" value={sheet.parkingFee} onChange={(event) => patch({ parkingFee: event.target.value })} /></Field>
      <YesNo label="Service" value={sheet.service} onChange={(next) => patch({ service: next })} />
      <YesNo label="Delivery" value={sheet.delivery} onChange={(next) => patch({ delivery: next })} />
      <YesNo label="Installation" value={sheet.installation} onChange={(next) => patch({ installation: next })} />
      <YesNo label="Warranty" value={sheet.warranty} onChange={(next) => patch({ warranty: next })} />
      <Choice label="Ladders and hop-ups checked" selected={sheet.ladderCheck} onClick={() => patch({ ladderCheck: !sheet.ladderCheck })} />
      <p className="text-sm text-grey">{FORM_NOTICES.receipts}</p>
      <div className="space-y-3">
        <h3 className="text-base font-semibold">Products</h3>
        {sheet.lines.map((line, index) => (
          <div key={index} className="space-y-2 rounded-2xl border border-line bg-card p-3">
            <Input aria-label="Product code" placeholder="Code" value={line.code} onChange={(event) => setLine(index, { code: event.target.value })} />
            <Input aria-label="Product description" placeholder="Description" value={line.description} onChange={(event) => setLine(index, { description: event.target.value })} />
            <Input aria-label="Reported job" placeholder="Reported job" value={line.reportedJob} onChange={(event) => setLine(index, { reportedJob: event.target.value })} />
          </div>
        ))}
        <button type="button" className="min-h-12 text-base font-semibold underline decoration-red" onClick={() => patch({ lines: [...sheet.lines, blankLine()] })}>
          Add product
        </button>
      </div>
      <Field label="Work carried out"><TextArea value={sheet.workCarriedOut} onChange={(event) => patch({ workCarriedOut: event.target.value })} /></Field>
      <div className="space-y-3">
        <h3 className="text-base font-semibold">Parts used</h3>
        {sheet.parts.map((part, index) => (
          <div key={index} className="grid grid-cols-[1fr_1.4fr_4.5rem] gap-2">
            <Input aria-label="Part code" placeholder="Code" value={part.code} onChange={(event) => setPart(index, { code: event.target.value })} />
            <Input aria-label="Part description" placeholder="Description" value={part.description} onChange={(event) => setPart(index, { description: event.target.value })} />
            <Input aria-label="Quantity" inputMode="decimal" value={part.qty} onChange={(event) => setPart(index, { qty: event.target.value })} />
          </div>
        ))}
        <button type="button" className="min-h-12 text-base font-semibold underline decoration-red" onClick={() => patch({ parts: [...sheet.parts, blankPart()] })}>
          Add part
        </button>
      </div>
      <YesNo label="Satisfied with rig / product location?" value={sheet.locationOk} onChange={(next) => patch({ locationOk: next })} />
      <YesNo label="Customer requested fixing to wall?" value={sheet.fixingWall} onChange={(next) => patch({ fixingWall: next })} />
      <YesNo label="Customer requested fixing to floor?" value={sheet.fixingFloor} onChange={(next) => patch({ fixingFloor: next })} />
      <p className="text-sm text-grey">{FORM_NOTICES.fixings}</p>
      <YesNo label="Customer satisfied with work?" value={sheet.workOk} onChange={(next) => patch({ workOk: next })} />
      <YesNo label="Site left in satisfactory condition?" value={sheet.siteOk} onChange={(next) => patch({ siteOk: next })} />
      <button type="button" onClick={onNext} className="min-h-14 w-full rounded-full bg-red text-base font-semibold text-white">
        Photos
      </button>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2 text-sm font-semibold">
      {label}
      {children}
    </label>
  );
}

function Invite({ installId, link, onLink }: { installId: string; link: string | null; onLink: (path: string | null) => void }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="space-y-2 rounded-2xl border border-line bg-card p-4">
      <button
        type="button"
        disabled={pending}
        className="min-h-12 text-base font-semibold underline decoration-red"
        onClick={() => {
          setPending(true);
          void createSubcontractorLink(installId).then((result) => {
            setPending(false);
            setMessage(result.message);
            onLink(result.path ?? null);
          });
        }}
      >
        Subcontractor link
      </button>
      {message ? <p className="text-sm">{message}</p> : null}
      {link ? <p className="text-sm font-semibold break-all">{link}</p> : null}
    </div>
  );
}
