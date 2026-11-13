"use client";

import { useActionState, useState } from "react";
import { Banner, Button, Field, Input } from "@/components/pulse/ui";
import { submitAccessForm } from "@/features/operations/access-actions";
import { basisText, orderedAnswers, termsBoxReady } from "@/lib/installs/access-ui";

type Line = { label?: string; rate?: number; unit?: string; basis?: string; mileage?: number };
type SavedMedia = { id: string; url?: string | null; mime?: string | null; kind?: string | null };
type Saved = {
  acceptedName?: string | null;
  answers?: Record<string, unknown> | null;
  media?: SavedMedia[];
};

export function AccessForm({
  token,
  versionLabel,
  lines,
  submitted = false,
  saved = null,
}: {
  token: string;
  versionLabel: string;
  lines: Line[];
  submitted?: boolean;
  saved?: Saved | null;
}) {
  const [state, action, pending] = useActionState(submitAccessForm, null);
  const [scrolled, setScrolled] = useState(false);
  const [sent, setSent] = useState<Saved | null>(saved);
  const done = submitted || state?.ok;

  if (done) {
    return (
      <div className="space-y-6">
        <Banner tone="success">{state?.message || "Access details received."}</Banner>
        <SentSummary saved={sent} />
        <AddMedia token={token} />
      </div>
    );
  }

  return (
    <form
      action={action}
      className="space-y-5"
      onSubmit={(event) => {
        const data = new FormData(event.currentTarget);
        setSent({
          acceptedName: String(data.get("acceptedName") ?? ""),
          answers: {
            groundFloor: data.get("groundFloor"),
            floorNumber: data.get("floorNumber"),
            dropZone: data.get("dropZone"),
          },
          media: [],
        });
      }}
    >
      <input type="hidden" name="token" value={token} />
      <YesNo name="groundFloor" label="Is the install room on the ground floor?" defaultYes />
      <Field label="If not, which floor?">
        <Input name="floorNumber" inputMode="numeric" />
      </Field>
      <YesNo name="hasLift" label="Is there a lift?" />
      <YesNo name="levelStepFree" label="Is the route level and step-free?" defaultYes />
      <YesNo name="doubleDoors" label="Are all doors double doors, or at least 1,400 mm by 1,950 mm clear?" defaultYes />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Smallest opening width mm">
          <Input name="openingWidth" inputMode="numeric" />
        </Field>
        <Field label="Height mm">
          <Input name="openingHeight" inputMode="numeric" />
        </Field>
      </div>
      <YesNo name="tailLift" label="Can a tail-lift lorry unload next to the entrance?" defaultYes />
      <Field label="Where is the drop zone?">
        <Input name="dropZone" />
      </Field>
      <YesNo name="startAtEight" label="Can the crew start at 08:00, with the room clear and the floor finished?" defaultYes />
      <YesNo name="roomClear" label="Will the room be clear?" defaultYes />
      <YesNo name="floorFinished" label="Will the floor be finished?" defaultYes />
      <YesNo name="townCentre" label="Is the site in a town or city centre?" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Site hours start">
          <Input name="hoursStart" type="time" defaultValue="08:00" />
        </Field>
        <Field label="Site hours end">
          <Input name="hoursEnd" type="time" defaultValue="17:00" />
        </Field>
      </div>
      <MediaPicker token={token} />
      <Terms lines={lines} versionLabel={versionLabel} onReady={() => setScrolled(true)} />
      {!scrolled ? <p className="text-sm text-grey">Scroll to the end of this list before you can accept.</p> : null}
      <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
        <input type="checkbox" name="accept" value="yes" disabled={!scrolled} className="mt-1 size-5 accent-[#ce0037]" />
        <span>
          By ticking this box you accept the Jordan Fitness Installation Terms and Conditions (version {versionLabel}), including the additional charges below.
        </span>
      </label>
      <Field label="Your name">
        <Input name="acceptedName" required autoComplete="name" />
      </Field>
      <Button type="submit" disabled={pending || !scrolled} className="w-full">
        {pending ? "Sending..." : "Send access details"}
      </Button>
      {state && !state.ok ? <Banner tone="error">{state.message}</Banner> : null}
    </form>
  );
}

function Terms({
  lines,
  versionLabel,
  onReady,
}: {
  lines: Line[];
  versionLabel: string;
  onReady: () => void;
}) {
  return (
    <div
      ref={(node) => {
        if (node && termsBoxReady(node.scrollHeight, node.clientHeight, false)) onReady();
      }}
      className="max-h-64 overflow-y-auto rounded-3xl border border-line bg-field p-4 text-sm leading-6"
      onScroll={(event) => {
        const node = event.currentTarget;
        if (termsBoxReady(node.scrollHeight, node.clientHeight, node.scrollTop + node.clientHeight >= node.scrollHeight - 12)) onReady();
      }}
    >
      <p className="font-semibold text-ink">Additional charges, version {versionLabel}, ex VAT</p>
      <ul className="mt-3 space-y-3">
        {lines.map((line) => (
          <li key={line.label}>
            <p className="text-ink">{line.label}</p>
            <p className="text-grey">
              {line.rate != null ? `£${Number(line.rate).toFixed(2)}` : basisText(line.basis)}
              {line.unit ? ` ${line.unit}` : ""}
              {line.mileage != null ? ` plus £${Number(line.mileage).toFixed(2)} per mile` : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MediaPicker({ token }: { token: string }) {
  const [items, setItems] = useState<{ name: string; url: string; progress: number; id?: string; error?: string; video: boolean }[]>([]);

  async function add(list: FileList | null) {
    for (const file of [...(list ?? [])]) {
      try {
        const url = URL.createObjectURL(file);
        const video = file.type.startsWith("video/");
        setItems((current) => [...current, { name: file.name, url, progress: 0, video }]);
        const uploaded = await uploadAccessFile(token, file, (progress) => {
          setItems((current) => current.map((item) => (item.url === url ? { ...item, progress } : item)));
        });
        setItems((current) => current.map((item) => (item.url === url ? { ...item, id: uploaded.id ?? undefined, error: uploaded.error ?? undefined, progress: uploaded.id ? 100 : item.progress } : item)));
      } catch {
        setItems((current) => [...current, { name: file.name, url: file.name, progress: 0, video: false, error: "Could not store that file." }]);
      }
    }
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">Photos or videos</legend>
      <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-line bg-field px-4 py-4 text-center text-sm font-semibold">
        Add photos or videos
        <input
          className="sr-only"
          type="file"
          accept="image/*,video/mp4,video/quicktime,.mp4,.mov"
          multiple
          onChange={(event) => {
            void add(event.target.files);
            event.target.value = "";
          }}
        />
      </label>
      <ul className="grid grid-cols-3 gap-2">
        {items.map((item) => (
          <li key={item.url} className="overflow-hidden rounded-2xl border border-line">
            {item.video ? (
              <video src={item.url} className="aspect-square w-full object-cover" muted />
            ) : (
              // Local preview of a file the customer just picked.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.url} alt="" className="aspect-square w-full object-cover" />
            )}
            <div className="h-1.5 bg-muted">
              <div className="h-full bg-primary" style={{ width: `${item.progress}%` }} />
            </div>
            {item.error ? <p className="px-1 py-1 text-xs text-destructive">{item.error}</p> : null}
            {item.id ? <input type="hidden" name="mediaId" value={item.id} /> : null}
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function AddMedia({ token }: { token: string }) {
  const [state, action, pending] = useActionState(submitAccessForm, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <h2 className="font-display text-2xl">Add photos or videos</h2>
      <MediaPicker token={token} />
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Sending..." : "Send"}</Button>
      {state && !state.ok ? <Banner tone="error">{state.message}</Banner> : null}
      {state?.ok ? <Banner tone="success">{state.message}</Banner> : null}
    </form>
  );
}

function SentSummary({ saved }: { saved: Saved | null }) {
  const rows = orderedAnswers(saved?.answers);
  return (
    <section className="space-y-3 rounded-3xl border border-line bg-card p-4">
      <h2 className="font-display text-2xl">What you sent</h2>
      {saved?.acceptedName ? <p className="text-sm">{saved.acceptedName}</p> : null}
      {rows.length > 0 ? (
        <dl className="space-y-2 text-sm">
          {rows.map((row) => (
            <div key={row.key} className="flex justify-between gap-3">
              <dt className="text-grey">{row.label}</dt>
              <dd className="text-right font-semibold">{row.text}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <MediaGallery media={saved?.media ?? []} />
    </section>
  );
}

export function MediaGallery({ media }: { media: SavedMedia[] }) {
  if (media.length === 0) return null;
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {media.map((item) => (
        <li key={item.id} className="overflow-hidden rounded-2xl border border-line bg-field">
          {String(item.mime ?? item.kind ?? "").includes("video") ? (
            <video src={item.url ?? undefined} controls className="aspect-video w-full" />
          ) : item.url ? (
            // Signed customer media. The URL is short-lived.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.url} alt="" className="aspect-square w-full object-cover" />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

async function uploadAccessFile(token: string, file: File, onProgress: (value: number) => void) {
  try {
    const mime = file.type || (file.name.toLowerCase().endsWith(".mov") ? "video/quicktime" : "application/octet-stream");
    const signed = await fetch("/api/access/media/sign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, mime, byteSize: file.size }),
    });
    const signBody = await signed.json() as { signedUrl?: string; path?: string; message?: string };
    if (!signed.ok || !signBody.signedUrl || !signBody.path) {
      return { id: null, error: signBody.message || "Could not start that upload." };
    }
    await putFile(signBody.signedUrl, file, onProgress);
    const checksum = await sha256(file);
    const registered = await fetch("/api/access/media/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, path: signBody.path, mime, byteSize: file.size, checksum }),
    });
    const saved = await registered.json() as { fileId?: string; message?: string };
    if (!registered.ok || !saved.fileId) return { id: null, error: saved.message || "Could not store that file." };
    return { id: saved.fileId, error: null };
  } catch {
    return { id: null, error: "Could not store that file." };
  }
}

function putFile(url: string, file: File, onProgress: (value: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("file", file);
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => (request.status < 300 ? resolve() : reject(new Error("upload failed")));
    request.onerror = () => reject(new Error("upload failed"));
    request.send(body);
  });
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function YesNo({ name, label, defaultYes = false }: { name: string; label: string; defaultYes?: boolean }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-ink">{label}</legend>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <label className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line">
          <input type="radio" name={name} value="yes" defaultChecked={defaultYes} className="accent-[#ce0037]" /> Yes
        </label>
        <label className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-line">
          <input type="radio" name={name} value="no" defaultChecked={!defaultYes} className="accent-[#ce0037]" /> No
        </label>
      </div>
    </fieldset>
  );
}

