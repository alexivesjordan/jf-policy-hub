"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { VisitFlow, type VisitScreen } from "@/components/field/visit-flow";
import { setServiceProgress } from "@/features/service/actions";
import type { ServiceVisit } from "@/features/service/queries";
import { ServiceSheetNote } from "@/components/service/sheet-note";
import { Button, TextArea } from "@/components/pulse/ui";
import { navigationLinks } from "@/lib/maps/navigation";
import { formatAddress, mailHref, telHref, visitStatusLabel, visitTypeLabel, VISIT_STATUSES } from "@/lib/service/model";
import { engineerJobPath } from "@/lib/service/visit-route";

export function MyDayList({ dayLabel, stops }: { dayLabel: string; stops: ServiceVisit[] }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{dayLabel}</h1>
      {stops.length === 0 ? <p>No stops today.</p> : null}
      <ul className="space-y-3">
        {stops.map((stop, index) => {
          const address = formatAddress(stop);
          const links = navigationLinks(address);
          const phone = telHref(stop.contactPhone);
          const email = mailHref(stop.contactEmail);
          return (
            <li key={stop.id} className="rounded-3xl border border-line bg-card p-4">
              <p className="text-lg font-semibold">{index + 1}. {stop.customerName}</p>
              <p className="mt-1 text-sm text-grey">{visitTypeLabel(stop.visitType)} · {visitStatusLabel(stop.status)}</p>
              {address ? <p className="mt-2">{address}</p> : null}
              {stop.contactName ? <p className="mt-2">{stop.contactName}</p> : null}
              <p className="mt-1 flex flex-wrap gap-3">
                {phone ? <a className="font-semibold underline" href={phone}>{stop.contactPhone}</a> : null}
                {email ? <a className="font-semibold underline" href={email}>{stop.contactEmail}</a> : null}
              </p>
              {stop.notes ? <p className="mt-2">{stop.notes}</p> : null}
              {links ? (
                <p className="mt-3 flex gap-3">
                  <a className="inline-flex min-h-11 items-center font-semibold underline" href={links.waze}>Waze</a>
                  <a className="inline-flex min-h-11 items-center font-semibold underline" href={links.google}>Google Maps</a>
                </p>
              ) : null}
              <Link href={engineerJobPath(stop.id)} className="mt-3 inline-flex min-h-12 items-center text-base font-semibold text-red">Open</Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function MyDayStop({
  stop,
  sheet,
  flow,
}: {
  stop: ServiceVisit;
  sheet: { submitted: boolean; pdfUrl: string | null } | null;
  flow: VisitScreen | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(stop.status);
  const [reason, setReason] = useState(stop.incompleteReason);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const address = formatAddress(stop);
  const links = navigationLinks(address);
  const phone = telHref(stop.contactPhone);
  const email = mailHref(stop.contactEmail);
  const work = stop.lines.filter((line) => line.kind === "work");
  const going = stop.lines.filter((line) => line.kind === "swap_out");
  const back = stop.lines.filter((line) => line.kind === "swap_back");

  async function save(next: string) {
    setPending(true);
    setError(null);
    const result = await setServiceProgress(stop.id, next, reason);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setStatus(next);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-grey">{visitTypeLabel(stop.visitType)}</p>
        <h1 className="text-2xl font-semibold">{stop.customerName}</h1>
        {address ? <p className="mt-2">{address}</p> : null}
        {stop.contactName ? <p className="mt-2">{stop.contactName}</p> : null}
        <p className="mt-1 flex flex-wrap gap-3">
          {phone ? <a className="inline-flex min-h-11 items-center font-semibold underline" href={phone}>{stop.contactPhone}</a> : null}
          {email ? <a className="inline-flex min-h-11 items-center font-semibold underline" href={email}>{stop.contactEmail}</a> : null}
        </p>
        {links ? (
          <p className="mt-2 flex gap-3">
            <a className="inline-flex min-h-12 items-center rounded-full bg-red px-4 font-semibold text-white" href={links.waze}>Waze</a>
            <a className="inline-flex min-h-12 items-center rounded-full border border-line px-4 font-semibold" href={links.google}>Google Maps</a>
          </p>
        ) : null}
      </div>
      {stop.notes ? <p>{stop.notes}</p> : null}
      <LineList title="What's required" lines={work} />
      {stop.visitType === "swap" ? (
        <>
          <LineList title="Kit going out" lines={going} />
          <LineList title="Kit coming back" lines={back} />
        </>
      ) : null}
      {stop.assets.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold">Equipment</h2>
          <ul className="mt-2 space-y-1">
            {stop.assets.map((asset) => (
              <li key={`${asset.make}-${asset.model}-${asset.serial}`}>{[asset.make, asset.model, asset.serial].filter(Boolean).join(" · ")}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {stop.completionNote ? (
        <section>
          <h2 className="text-sm font-semibold">Earlier note</h2>
          <p className="mt-2">{stop.completionNote}</p>
        </section>
      ) : null}
      {error ? <p className="text-sm font-semibold text-red">{error}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        {VISIT_STATUSES.filter(([value]) => value !== "done").map(([value, label]) => (
          <Button key={value} type="button" variant={status === value ? "primary" : "secondary"} disabled={pending || Boolean(sheet?.submitted)} onClick={() => void save(value)}>
            {label}
          </Button>
        ))}
      </div>
      {status === "incomplete" && !sheet?.submitted ? (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Reason</span>
            <TextArea value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <Button type="button" disabled={pending} onClick={() => void save("incomplete")}>{pending ? "Saving" : "Save reason"}</Button>
        </div>
      ) : null}
      <ServiceSheetNote sheet={sheet} />
      {flow ? <VisitFlow screen={flow} /> : null}
      {stop.photos.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2">
          {stop.photos.map((photo) => (
            <li key={photo.id}>
              <div role="img" aria-label="Photo" className="h-32 w-full rounded-2xl border border-line bg-card bg-cover bg-center" style={photo.url ? { backgroundImage: `url("${photo.url}")` } : undefined} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LineList({ title, lines }: { title: string; lines: ServiceVisit["lines"] }) {
  if (lines.length === 0) return null;
  return (
    <section>
      <h2 className="text-sm font-semibold">{title}</h2>
      <ul className="mt-2 space-y-2">
        {lines.map((line, index) => (
          <li key={`${line.sku}-${index}`} className="rounded-2xl border border-line px-3 py-2">
            <p className="font-semibold">{line.description || line.sku || "Item"}</p>
            <p className="text-sm text-grey">{[line.sku && line.description ? line.sku : "", line.serial && `Serial ${line.serial}`, line.fault, line.parts && `Parts ${line.parts}`].filter(Boolean).join(" · ")}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
