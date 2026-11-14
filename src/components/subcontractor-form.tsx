"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Banner, Button, Field, Input, Select, TextArea } from "@/components/pulse/ui";
import { completeInsuranceUpload, dropInsurance, removeSubcontractor, saveSubcontractor, signInsuranceUpload } from "@/features/subcontractors/actions";
import { emailNeedsCheck, insuranceInDate, type SubcontractorRecord } from "@/lib/subcontractors/capability";
import { createClient } from "@/lib/supabase/client";

const STATUSES = [
  ["active", "Active"],
  ["preferred", "Preferred"],
  ["on_hold", "On hold"],
  ["inactive", "Inactive"],
] as const;

export function SubcontractorForm({ record }: { record?: SubcontractorRecord }) {
  const [state, action, pending] = useActionState(saveSubcontractor, null);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      {record ? <input type="hidden" name="id" value={record.id} /> : null}
      <Field label="Name"><Input name="name" required defaultValue={record?.name ?? ""} /></Field>
      <Field label="Contact name"><Input name="contactName" defaultValue={record?.contactName ?? ""} /></Field>
      <Field label="Email" hint="Separate more than one with a comma."><Input name="emails" defaultValue={record?.emails.join(", ") ?? ""} /></Field>
      <Field label="Phone"><Input name="phone" defaultValue={record?.phone ?? ""} /></Field>
      <Field label="Areas" hint="Separate areas with a comma. Leave blank when the sheet states no limit."><Input name="regions" defaultValue={record?.regions.join(", ") ?? ""} /></Field>
      <Field label="Job types" hint="install, flooring, service"><Input name="jobTypes" defaultValue={record?.jobTypes.join(", ") ?? "install"} /></Field>
      <Field label="Max crew"><Input name="maxCrew" type="number" min={1} defaultValue={record?.maxCrew ?? ""} /></Field>
      <Field label="Status">
        <Select name="status" defaultValue={record?.status ?? "active"}>
          {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
      </Field>
      <div className="md:col-span-2"><Field label="Notes"><TextArea name="notes" defaultValue={record?.notes ?? ""} /></Field></div>
      {state ? <div className="md:col-span-2"><Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner></div> : null}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : record ? "Save" : "Add subcontractor"}</Button>
    </form>
  );
}

export function InsurancePanel({ record, today }: { record: SubcontractorRecord; today: string }) {
  const router = useRouter();
  const covered = insuranceInDate(record.insurance, today);
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);

  async function upload(formData: FormData) {
    const file = formData.get("file");
    const expiresOn = String(formData.get("expiresOn") ?? "");
    const label = String(formData.get("label") ?? "");
    if (!(file instanceof File) || file.size === 0) {
      setOk(false);
      setMessage("Choose an insurance document.");
      return;
    }
    setPending(true);
    const signed = await signInsuranceUpload(record.id, file.type || "application/pdf", file.size);
    if (!signed.ok || !signed.path || !signed.token) {
      setPending(false);
      setOk(false);
      setMessage(signed.message);
      return;
    }
    if (signed.token !== "fixture") {
      const browser = createClient();
      const uploaded = await browser.storage.from("insurance").uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type || "application/pdf" });
      if (uploaded.error) {
        setPending(false);
        setOk(false);
        setMessage("Could not store that document.");
        return;
      }
    }
    const saved = await completeInsuranceUpload({ subcontractorId: record.id, path: signed.path, mimeType: file.type || "application/pdf", byteSize: file.size, expiresOn, label });
    setPending(false);
    setOk(Boolean(saved?.ok));
    setMessage(saved?.message ?? "Could not attach that document.");
    if (saved?.ok) router.refresh();
  }

  return (
    <section className="space-y-4 rounded-3xl border border-line bg-card px-5 py-5">
      <h2 className="font-display text-2xl">Insurance</h2>
      {covered ? <p className="text-sm font-semibold">In date</p> : <Banner tone="error">No in-date insurance. This subcontractor cannot be selected or emailed.</Banner>}
      {emailNeedsCheck(record.emails) ? <Banner tone="warning">Check email. The address on the sheet needs correcting.</Banner> : null}
      {record.insurance.length === 0 ? <p className="text-sm text-grey">No documents yet.</p> : (
        <ul className="space-y-2 text-sm">
          {record.insurance.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line px-3 py-2">
              <span>{doc.label || "Insurance"} · expires {uk(doc.expiresOn)}{doc.expiresOn < today ? " · expired" : ""}</span>
              <span className="flex items-center gap-3">
                {doc.url ? <a className="font-semibold underline" href={doc.url}>Open</a> : null}
                <DropButton subcontractorId={record.id} documentId={doc.id} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <form action={upload} className="grid gap-3 md:grid-cols-[1fr_12rem_auto] md:items-end">
        <Field label="Document"><Input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required /></Field>
        <Field label="Expiry"><Input name="expiresOn" type="date" required /></Field>
        <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Uploading…" : "Add document"}</Button>
        <div className="md:col-span-3"><Field label="Label"><Input name="label" placeholder="Employers liability" /></Field></div>
      </form>
      {message ? <Banner tone={ok ? "success" : "error"}>{message}</Banner> : null}
    </section>
  );
}

export function RemoveSubcontractor({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <div className="space-y-2">
      {confirming ? (
        <Button type="button" variant="danger" disabled={pending} onClick={async () => {
          setPending(true);
          const result = await removeSubcontractor(id);
          setPending(false);
          setMessage(result?.message ?? "Could not remove that subcontractor.");
          if (result?.ok) router.push("/operations/subcontractors");
        }}>{pending ? "Removing…" : "Remove this subcontractor"}</Button>
      ) : <Button type="button" variant="danger" onClick={() => setConfirming(true)}>Remove</Button>}
      {message ? <p className="text-sm">{message}</p> : null}
    </div>
  );
}

function DropButton({ subcontractorId, documentId }: { subcontractorId: string; documentId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button type="button" className="text-sm font-semibold underline disabled:opacity-60" disabled={pending} onClick={async () => {
      setPending(true);
      await dropInsurance(subcontractorId, documentId);
      setPending(false);
      router.refresh();
    }}>Remove</button>
  );
}

function uk(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}
