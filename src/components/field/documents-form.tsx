"use client";

import { useState } from "react";
import { issueDocumentUpload, registerDocumentUpload } from "@/features/field/actions";
import { putSignedUpload } from "@/lib/installs/browser-upload";
import { DOCUMENT_LABELS, VISIT_DOCUMENTS, type VisitDocumentKey } from "@/lib/installs/product-lines";

export function DocumentsForm({ uploaded }: { uploaded: VisitDocumentKey[] }) {
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState<VisitDocumentKey | null>(null);

  return (
    <ul className="space-y-4">
      {message ? <li className={`text-sm font-semibold ${ok ? "text-ink" : "text-red"}`}>{message}</li> : null}
      {VISIT_DOCUMENTS.map((key) => (
        <li key={key} className="space-y-3 rounded-3xl border border-line bg-card p-4">
          <p className="text-base font-semibold">{DOCUMENT_LABELS[key]}</p>
          <p className="text-sm text-grey">{uploaded.includes(key) ? "Uploaded" : "Not uploaded yet"}</p>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              const file = new FormData(event.currentTarget).get("file");
              if (!(file instanceof File) || file.size === 0) return;
              setPending(key);
              void upload(key, file).then((result) => {
                setPending(null);
                setOk(result.ok);
                setMessage(result.message);
              });
            }}
          >
            <input name="file" type="file" accept="application/pdf" required className="block w-full text-base" />
            <button type="submit" disabled={pending === key} className="min-h-12 rounded-full bg-red px-4 text-base font-semibold text-white disabled:opacity-60">
              {pending === key ? "Uploading" : "Upload"}
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}

async function upload(key: VisitDocumentKey, file: File) {
  const issued = await issueDocumentUpload(file.size);
  if (!issued.ok || !issued.ticket) return issued;
  try {
    await putSignedUpload(issued.ticket, file, "application/pdf");
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not upload that PDF." };
  }
  return registerDocumentUpload(key, issued.ticket.path, file.size);
}
