"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MediaGallery } from "@/components/access-form";
import { Banner, Button, Field, Input } from "@/components/pulse/ui";
import { copyInstallAccessLink, resendInstallAccess, setInstallContactEmail } from "@/features/sales/install-actions";
import { accessChip, orderedAnswers } from "@/lib/installs/access-ui";

export function InstallAccessPanel({ install }: { install: Record<string, unknown> }) {
  const access = install.access && typeof install.access === "object" ? install.access as {
    sentAt?: string | null;
    submittedAt?: string | null;
    mediaCount?: number | null;
    needsCustomerEmail?: boolean;
    answers?: Record<string, unknown> | null;
    media?: { id: string; url?: string | null; mime?: string | null; kind?: string | null }[];
  } : null;
  const needsEmail = !install.contactEmail;
  const chip = accessChip(access);
  const noPhotos = Boolean(access?.submittedAt) && Number(access?.mediaCount ?? access?.media?.length ?? 0) === 0;
  const notEmailed = chip === "Not sent" && Boolean(install.contactEmail);
  return (
    <section className="space-y-4 rounded-3xl border border-line bg-card px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl">Access</h2>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">{chip}</span>
      </div>
      {noPhotos ? <p className="text-sm text-grey">no photos</p> : null}
      {notEmailed ? <p className="text-sm">Access form not emailed</p> : null}
      {needsEmail ? <EmailPrompt installId={String(install.id ?? "")} /> : null}
      <LinkActions installId={String(install.id ?? "")} />
      <Answers answers={access?.answers ?? null} />
      <MediaGallery media={access?.media ?? []} />
    </section>
  );
}

function EmailPrompt({ installId }: { installId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <form
      className="space-y-3 rounded-2xl border border-line p-3"
      onSubmit={(event) => {
        event.preventDefault();
        setPending(true);
        void setInstallContactEmail(installId, email).then((result) => {
          setMessage(result.message);
          setPending(false);
          if (result.ok) router.refresh();
        });
      }}
    >
      <p className="text-sm font-semibold">Customer email</p>
      <Field label="Email">
        <Input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
      </Field>
      <Button type="submit" disabled={pending}>{pending ? "Sending..." : "Send"}</Button>
      {message ? <Banner tone={message.includes("not") || message.includes("Could") ? "error" : "success"}>{message}</Banner> : null}
    </form>
  );
}

function LinkActions({ installId }: { installId: string }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<"copy" | "resend" | null>(null);
  const [confirmResend, setConfirmResend] = useState(false);
  async function copy() {
    setPending("copy");
    const result = await copyInstallAccessLink(installId);
    if (result.ok && result.path) {
      const path = result.path.startsWith("http") ? result.path : `${window.location.origin}${result.path}`;
      try {
        await navigator.clipboard.writeText(path);
        setMessage("Link copied.");
      } catch {
        setMessage(path);
      }
    } else {
      setMessage(result.message);
    }
    setPending(null);
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="secondary" disabled={pending !== null} onClick={() => void copy()}>
        {pending === "copy" ? "Copying..." : "Copy link"}
      </Button>
      {confirmResend ? (
        <>
          <p className="w-full text-sm">The old link will stop working.</p>
          <Button
            type="button"
            variant="secondary"
            disabled={pending !== null}
            onClick={() => {
              setPending("resend");
              void resendInstallAccess(installId).then((result) => {
                setMessage(result.message);
                setPending(null);
                setConfirmResend(false);
              });
            }}
          >
            {pending === "resend" ? "Sending..." : "Send new link"}
          </Button>
          <Button type="button" variant="secondary" disabled={pending !== null} onClick={() => setConfirmResend(false)}>Cancel</Button>
        </>
      ) : (
        <Button type="button" variant="secondary" disabled={pending !== null} onClick={() => setConfirmResend(true)}>
          Resend link
        </Button>
      )}
      {message ? <p className="w-full text-sm">{message}</p> : null}
    </div>
  );
}

function Answers({ answers }: { answers: Record<string, unknown> | null }) {
  const rows = orderedAnswers(answers);
  if (rows.length === 0) return null;
  return (
    <dl className="space-y-2 text-sm">
      {rows.map((row) => (
        <div key={row.key} className="flex justify-between gap-3">
          <dt className="text-grey">{row.label}</dt>
          <dd className="text-right font-semibold">{row.text}</dd>
        </div>
      ))}
    </dl>
  );
}
