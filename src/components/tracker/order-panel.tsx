"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banner, Button, Field, Input } from "@/components/pulse/ui";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { addTrackerPhoto, createOrderTracker, regenerateOrderTracker, revokeOrderTracker, setTrackerPhotoVisible, type TrackerAction } from "@/features/tracker/actions";
import { compressImageFile } from "@/lib/installs/compress-image";
import type { StaffLink } from "@/lib/tracker/load-types";
import type { TrackerSnapshot } from "@/lib/tracker/snapshot";
import { londonWhen, quantityLabel } from "@/lib/tracker/stages";

const STATUS_LABEL = { active: "Active", expired: "Expired", revoked: "Revoked" } as const;

export function OrderPanel({ snapshot, links }: { snapshot: TrackerSnapshot; links: StaffLink[] }) {
  const blocking = links.some((link) => link.status === "active" || link.status === "expired");
  const [issued, setIssued] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"ok" | "error">("ok");

  function report(result: TrackerAction) {
    setTone(result.ok ? "ok" : "error");
    setMessage(result.message);
    if (result.link) setIssued(result.link);
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="font-display text-2xl break-words">{snapshot.orderNumber}</h2>
        {snapshot.customerName ? <p className="text-sm font-semibold break-words">{snapshot.customerName}</p> : null}
        {snapshot.items.length > 0 ? (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-grey">
                <th className="py-2 pr-3 font-semibold">Item</th>
                <th className="py-2 text-right font-semibold">Qty</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.items.map((item) => (
                <tr key={`${item.name}-${item.quantity}`} className="border-b border-line">
                  <td className="py-3 pr-3 break-words">{item.name}</td>
                  <td className="py-3 text-right tabular-nums">{quantityLabel(item.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-sm text-grey">No items on this order.</p>}
      </section>

      {message ? <Banner tone={tone === "ok" ? "success" : "error"}>{message}</Banner> : null}
      {issued ? <CopyLink url={issued} /> : null}

      {blocking ? null : <CreateLink orderNumber={snapshot.orderNumber} onResult={report} />}

      {links.length === 0 ? <p className="text-sm text-grey">No tracking link yet.</p> : null}
      <ul className="space-y-4">
        {links.map((link) => (
          <li key={link.id} className="space-y-4 rounded-3xl border border-line bg-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold">{STATUS_LABEL[link.status]}</p>
              <p className="text-sm text-grey">{link.viewCount} {link.viewCount === 1 ? "view" : "views"}</p>
            </div>
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-grey">Created</dt>
                <dd>{londonWhen(link.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-grey">Expires</dt>
                <dd>{londonWhen(link.expiresOn)}</dd>
              </div>
            </dl>
            <div className="flex flex-col gap-2 sm:flex-row">
              {link.status === "active" ? <RevokeLink id={link.id} orderNumber={link.orderNumber} onResult={report} /> : null}
              <RegenerateLink id={link.id} orderNumber={link.orderNumber} onResult={report} />
            </div>
            <PhotoList link={link} onResult={report} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded-3xl border border-line bg-card p-4">
      <p className="text-sm font-semibold">Copy this link. It will not be shown again.</p>
      <Input readOnly value={url} aria-label="Tracking link" onFocus={(event) => event.currentTarget.select()} />
      <Button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(url).then(() => setCopied(true)).catch(() => setCopied(false));
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  );
}

function CreateLink({ orderNumber, onResult }: { orderNumber: string; onResult: (result: TrackerAction) => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void createOrderTracker(orderNumber).then((result) => {
          onResult(result);
          setPending(false);
          if (result.ok) router.refresh();
        });
      }}
    >
      {pending ? "Creating" : `Create link for ${orderNumber}`}
    </Button>
  );
}

function RevokeLink({ id, orderNumber, onResult }: { id: string; orderNumber: string; onResult: (result: TrackerAction) => void }) {
  return (
    <ConfirmAction
      label="Revoke"
      title={`Revoke the tracking link for ${orderNumber}?`}
      confirm={`Revoke ${orderNumber}`}
      danger
      run={() => revokeOrderTracker(id)}
      onResult={onResult}
    />
  );
}

function RegenerateLink({ id, orderNumber, onResult }: { id: string; orderNumber: string; onResult: (result: TrackerAction) => void }) {
  return (
    <ConfirmAction
      label="Regenerate"
      title={`Regenerate the tracking link for ${orderNumber}?`}
      confirm={`Regenerate ${orderNumber}`}
      run={() => regenerateOrderTracker(id)}
      onResult={onResult}
    />
  );
}

function PhotoList({ link, onResult }: { link: StaffLink; onResult: (result: TrackerAction) => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function upload(list: FileList | null, caption: string) {
    const file = list?.[0];
    if (!file) return;
    setPending(true);
    setMessage(null);
    try {
      const compressed = await compressImageFile(file);
      const body = new FormData();
      body.set("trackerId", link.id);
      body.set("caption", caption);
      body.set("photo", compressed);
      const result = await addTrackerPhoto(body);
      onResult(result);
      if (result.ok) router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That photo could not be stored.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">QC photos</h3>
      {link.status === "active" ? (
        <PhotoUpload pending={pending} onPick={upload} />
      ) : null}
      {message ? <p className="text-sm font-semibold text-red">{message}</p> : null}
      {link.photos.length === 0 ? <p className="text-sm text-grey">No photos.</p> : null}
      <ul className="grid grid-cols-2 gap-2">
        {link.photos.map((photo) => (
          <li key={photo.id} className="min-w-0 space-y-2">
            {photo.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- staff previews use short-lived signed URLs
              <img src={photo.url} alt={photo.caption || "QC photo"} className="h-32 w-full rounded-2xl border border-line object-cover" />
            ) : <div className="h-32 rounded-2xl border border-line bg-paper" />}
            <p className="text-sm break-words">{photo.visible ? "Shown" : "Hidden"}{photo.caption ? ` · ${photo.caption}` : ""}</p>
            <ConfirmAction
              label={photo.visible ? "Hide" : "Show"}
              title={photo.visible ? `Hide this photo on ${link.orderNumber}?` : `Show this photo on ${link.orderNumber}?`}
              confirm={photo.visible ? `Hide photo on ${link.orderNumber}` : `Show photo on ${link.orderNumber}`}
              danger={photo.visible}
              run={() => setTrackerPhotoVisible(photo.id, !photo.visible)}
              onResult={onResult}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PhotoUpload({ pending, onPick }: { pending: boolean; onPick: (list: FileList | null, caption: string) => void }) {
  const [caption, setCaption] = useState("");
  return (
    <div className="space-y-2">
      <Field label="Caption">
        <Input value={caption} maxLength={200} onChange={(event) => setCaption(event.target.value)} />
      </Field>
      <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-line bg-card px-4 text-base font-semibold">
        {pending ? "Uploading" : "Add QC photo"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={pending}
          onChange={(event) => {
            void onPick(event.target.files, caption);
            event.target.value = "";
          }}
        />
      </label>
    </div>
  );
}

function ConfirmAction({
  label,
  title,
  confirm,
  danger,
  run,
  onResult,
}: {
  label: string;
  title: string;
  confirm: string;
  danger?: boolean;
  run: () => Promise<TrackerAction>;
  onResult: (result: TrackerAction) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant={danger ? "danger" : "secondary"} />}>{label}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{title}</DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant={danger ? "danger" : "primary"}
            disabled={pending}
            onClick={() => {
              setPending(true);
              void run().then((result) => {
                onResult(result);
                setPending(false);
                if (result.ok) {
                  setOpen(false);
                  router.refresh();
                }
              });
            }}
          >
            {pending ? "Saving" : confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
