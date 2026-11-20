"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PhotoPicker, type StoredPhoto } from "@/components/field/photo-picker";
import { saveHqBuildPhoto, startInstallJob } from "@/features/field/prep-actions";
import type { JobBriefing } from "@/features/field/queries";
import { orderedAnswers } from "@/lib/installs/access-ui";
import type { OrderLineView } from "@/lib/installs/visit-form";
import { formatDate } from "@/lib/format";

export function JobBriefingView({
  installId,
  orderNumber,
  customerName,
  siteAddress,
  startOn,
  endOn,
  lines,
  briefing,
}: {
  installId: string;
  orderNumber: string;
  customerName: string;
  siteAddress: string | null;
  startOn: string;
  endOn: string;
  lines: OrderLineView[];
  briefing: JobBriefing;
}) {
  const answers = orderedAnswers(briefing.accessAnswers);
  const hqNames = new Set(briefing.hqItems.map((item) => item.name.toLowerCase()));
  const siteLines = lines.filter((line) => !hqNames.has(line.description.toLowerCase()));
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="font-display text-3xl">Briefing</h2>
        <p className="text-base font-semibold">{customerName}</p>
        <p>{siteAddress || "No site address yet."}</p>
        <p className="text-sm text-grey">{formatDate(startOn)} – {formatDate(endOn)} · {orderNumber}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-grey">Access</h2>
        {answers.length === 0 ? <p>No access form yet.</p> : (
          <ul className="space-y-1">
            {answers.map((row) => (
              <li key={row.key}><span className="font-semibold">{row.label}.</span> {row.text}</li>
            ))}
          </ul>
        )}
        {briefing.accessMedia.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3">
            {briefing.accessMedia.map((file) => (
              <li key={file.id} className="overflow-hidden rounded-2xl border border-line bg-card">
                {file.url && file.mime?.startsWith("video") ? (
                  <video src={file.url} controls className="aspect-square w-full bg-black object-contain" />
                ) : file.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={file.url} alt="" className="aspect-square w-full object-cover" />
                ) : <div className="aspect-square w-full" />}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-grey">Kit</h2>
        {lines.length === 0 ? <p>No kit lines.</p> : (
          <ul className="space-y-1">
            {lines.map((line, index) => (
              <li key={`${line.sku}-${index}`}>{line.qty ?? ""} {line.description}{line.sku ? ` · ${line.sku}` : ""}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-grey">Build plan</h2>
        <p>Crew {briefing.crew ?? "—"}{briefing.hqHours != null ? ` · HQ ${briefing.hqHours} h` : ""}{briefing.siteDays != null ? ` · Site ${briefing.siteDays} day${briefing.siteDays === 1 ? "" : "s"}` : ""}{briefing.siteHours != null ? ` · ${briefing.siteHours} h on site` : ""}</p>
        <div>
          <p className="font-semibold">HQ build</p>
          {briefing.hqItems.length === 0 ? <p>None.</p> : (
            <ul className="mt-2 space-y-4">
              {briefing.hqItems.map((item) => (
                <HqItem key={item.key} installId={installId} item={item} />
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="font-semibold">Site build</p>
          {siteLines.length === 0 ? <p>None.</p> : (
            <ul>
              {siteLines.map((line, index) => (
                <li key={`${line.description}-${index}`}>{line.qty ?? ""} {line.description}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-grey">Tasks</h2>
        {briefing.tasks.length === 0 ? <p>No preparation tasks.</p> : (
          <ul className="space-y-2">
            {briefing.tasks.map((task) => (
              <li key={task.id}>
                <p className="font-semibold">{task.title}</p>
                <p className="text-sm text-grey">{task.status.replaceAll("_", " ")}{task.dueOn ? ` · due ${formatDate(task.dueOn)}` : ""}</p>
                {task.body ? <p className="whitespace-pre-line text-sm">{task.body}</p> : null}
                {task.kind === "vehicle_check" ? (
                  <Link href={`/field/${installId}/vehicle`} className="inline-flex min-h-12 items-center font-semibold underline decoration-red">
                    {briefing.vehicleCheck ? "Vehicle check is in" : "Vehicle check"}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {briefing.started ? null : <StartJob installId={installId} canStart={briefing.canStart} />}
    </div>
  );
}

function HqItem({ installId, item }: { installId: string; item: JobBriefing["hqItems"][number] }) {
  const router = useRouter();
  const [photos, setPhotos] = useState<StoredPhoto[]>(item.photos.flatMap((photo) => photo.id ? [{ id: photo.id, url: photo.url ?? "" }] : []));
  const [message, setMessage] = useState<string | null>(null);

  async function onChange(next: StoredPhoto[]) {
    const known = new Set(photos.map((photo) => photo.id));
    setPhotos(next);
    for (const photo of next) {
      if (known.has(photo.id)) continue;
      const result = await saveHqBuildPhoto(installId, item.key, photo.id);
      setMessage(result.message);
      if (result.ok) router.refresh();
    }
  }

  return (
    <li className="space-y-2">
      <p>{item.qty} x {item.name}{item.sku ? ` · ${item.sku}` : ""}</p>
      <PhotoPicker installId={installId} token={null} kind="hq_photo" photos={photos} onChange={(next) => void onChange(next)} label="Photograph this item" />
      {message ? <p className="text-sm">{message}</p> : null}
    </li>
  );
}

function StartJob({ installId, canStart }: { installId: string; canStart: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function start() {
    setPending(true);
    const result = await startInstallJob(installId);
    setPending(false);
    setMessage(result.message);
    if (result.ok) router.refresh();
  }

  return (
    <section className="space-y-2">
      <button type="button" disabled={!canStart || pending} onClick={() => void start()} className="min-h-14 w-full rounded-full bg-red text-base font-semibold text-white disabled:opacity-60">
        {pending ? "Starting" : "Start this job"}
      </button>
      {canStart ? null : <p className="text-sm text-grey">Available on an install day.</p>}
      {message ? <p className="text-sm font-semibold">{message}</p> : null}
    </section>
  );
}
