"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FieldFrame } from "@/components/field/frame";
import { SiteNavLinks } from "@/components/field/site-nav";
import { VisitFlow, type VisitScreen } from "@/components/field/visit-flow";
import { ServiceSheetNote } from "@/components/service/sheet-note";
import { setServiceProgress } from "@/features/service/actions";
import type { ServiceVisit } from "@/features/service/queries";
import { Button, TextArea } from "@/components/pulse/ui";
import { formatDate } from "@/lib/format";
import { formatAddress, mailHref, telHref, visitStatusLabel, visitTypeLabel, VISIT_STATUSES } from "@/lib/service/model";

export function ServiceJobView({
  stop,
  sheet,
  flow,
  back,
  canUpdate,
}: {
  stop: ServiceVisit;
  sheet: { submitted: boolean; pdfUrl: string | null } | null;
  flow: VisitScreen | null;
  back: { href: string; label: string };
  canUpdate: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(stop.status);
  const [reason, setReason] = useState(stop.incompleteReason);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const address = formatAddress(stop);
  const phone = telHref(stop.contactPhone);
  const email = mailHref(stop.contactEmail);
  const work = stop.lines.filter((line) => line.kind === "work");
  const going = stop.lines.filter((line) => line.kind === "swap_out");
  const backKit = stop.lines.filter((line) => line.kind === "swap_back");
  const window = stop.windowStart && stop.windowEnd ? `${stop.windowStart}–${stop.windowEnd}` : stop.windowStart || stop.windowEnd;
  const title = stop.cin7OrderNumber || stop.customerName;

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
    <FieldFrame title={title} back={back}>
      <div className="space-y-8">
        <section className="space-y-2">
          <h2 className="font-display text-3xl">Job</h2>
          <p className="text-base font-semibold">{stop.customerName}</p>
          <p className="break-words">{address || "No site address yet."}</p>
          <SiteNavLinks line1={stop.addressLine1} line2={stop.addressLine2} city={stop.city} postcode={stop.postcode} />
          <p className="text-sm text-grey">
            {formatDate(stop.visitOn)}
            {window ? ` · ${window}` : ""}
            {` · ${stop.durationMinutes} min`}
            {` · ${visitTypeLabel(stop.visitType)}`}
          </p>
          {stop.contactName ? <p>{stop.contactName}</p> : null}
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            {phone ? <a className="inline-flex min-h-11 items-center font-semibold underline decoration-red" href={phone}>{stop.contactPhone}</a> : null}
            {email ? <a className="inline-flex min-h-11 items-center break-all font-semibold underline decoration-red" href={email}>{stop.contactEmail}</a> : null}
          </p>
          {stop.assignees.length > 0 ? (
            <p className="text-sm text-grey">Assigned {stop.assignees.map((person) => person.name).join(", ")}</p>
          ) : null}
        </section>

        {stop.notes ? <p className="break-words">{stop.notes}</p> : null}
        <LineList title="Kit" lines={work} />
        {stop.visitType === "swap" ? (
          <>
            <LineList title="Kit going out" lines={going} />
            <LineList title="Kit coming back" lines={backKit} />
          </>
        ) : null}
        {stop.assets.length > 0 ? (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-grey">Equipment</h2>
            <ul className="space-y-1">
              {stop.assets.map((asset) => (
                <li key={`${asset.make}-${asset.model}-${asset.serial}`} className="break-words">{[asset.make, asset.model, asset.serial].filter(Boolean).join(" · ")}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {stop.completionNote ? (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-grey">Earlier note</h2>
            <p className="break-words">{stop.completionNote}</p>
          </section>
        ) : null}

        {error ? <p className="text-sm font-semibold text-red">{error}</p> : null}
        <div className="grid grid-cols-2 gap-2">
          {VISIT_STATUSES.filter(([value]) => value !== "done").map(([value, label]) => (
            <Button key={value} type="button" variant={status === value ? "primary" : "secondary"} disabled={!canUpdate || pending || Boolean(sheet?.submitted)} onClick={() => void save(value)}>
              {label}
            </Button>
          ))}
        </div>
        {canUpdate && status === "incomplete" && !sheet?.submitted ? (
          <div className="space-y-2">
            <label className="block space-y-1">
              <span className="text-sm font-semibold">Reason</span>
              <TextArea value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
            <Button type="button" disabled={pending} onClick={() => void save("incomplete")}>{pending ? "Saving" : "Save reason"}</Button>
          </div>
        ) : null}
        <p className="text-sm text-grey">{visitStatusLabel(status)}</p>
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
    </FieldFrame>
  );
}

function LineList({ title, lines }: { title: string; lines: ServiceVisit["lines"] }) {
  if (lines.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-grey">{title}</h2>
      <ul className="space-y-1">
        {lines.map((line, index) => (
          <li key={`${line.sku}-${index}`} className="break-words">
            {line.description || line.sku || "Item"}
            {line.sku && line.description ? ` · ${line.sku}` : ""}
            {line.serial ? ` · Serial ${line.serial}` : ""}
            {line.fault ? ` · ${line.fault}` : ""}
            {line.parts ? ` · Parts ${line.parts}` : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}
