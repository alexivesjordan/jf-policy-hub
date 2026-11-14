"use client";

import { useState } from "react";
import { SignaturePad } from "@/components/field/signature-pad";
import { saveStaffSignature } from "@/features/field/actions";

export function SignatureForm({ existingUrl }: { existingUrl: string | null }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!blob) {
          setOk(false);
          setMessage("Draw your signature.");
          return;
        }
        const body = new FormData();
        body.set("signature", new File([blob], "signature.png", { type: "image/png" }));
        setPending(true);
        void saveStaffSignature(body).then((result) => {
          setPending(false);
          setOk(result.ok);
          setMessage(result.message);
        });
      }}
    >
      {existingUrl ? (
        <div role="img" aria-label="Your saved signature" className="h-32 w-full rounded-2xl border border-line bg-white bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url("${existingUrl}")` }} />
      ) : null}
      <SignaturePad onChange={setBlob} />
      {message ? <p className={`text-sm font-semibold ${ok ? "text-ink" : "text-red"}`}>{message}</p> : null}
      <button type="submit" disabled={pending} className="min-h-14 w-full rounded-full bg-red text-base font-semibold text-white disabled:opacity-60">
        {pending ? "Saving" : "Save signature"}
      </button>
    </form>
  );
}
