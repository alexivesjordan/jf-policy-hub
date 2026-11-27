import type { PublicTrackerModel } from "@/lib/tracker/model";
import type { TrackerStageState } from "@/lib/tracker/stages";

const STATE_LABEL: Record<TrackerStageState, string> = {
  done: "Done",
  current: "Current",
  upcoming: "Not yet",
  skipped: "Skipped",
};

function Brand() {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-grey">Jordan Fitness</p>
      <p className="font-display text-2xl text-ink">Jordan Pulse</p>
    </div>
  );
}

export function TrackerNotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center bg-paper px-4">
      <Brand />
      <h1 className="font-display mt-4 text-4xl text-ink">That link is not valid</h1>
    </main>
  );
}

export function TrackerUnavailable() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center bg-paper px-4">
      <Brand />
      <h1 className="font-display mt-4 text-4xl text-ink">Order tracking is unavailable right now</h1>
    </main>
  );
}

export function TrackerView({ model }: { model: PublicTrackerModel }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-lg bg-paper px-4 py-8 text-ink">
      <Brand />
      <h1 className="font-display mt-4 text-4xl break-words">Order {model.orderNumber}</h1>
      {model.customerName ? <p className="mt-2 text-base font-semibold break-words">{model.customerName}</p> : null}
      {model.expectedLabel ? (
        <p className="mt-3 text-sm">
          Expected <time dateTime={model.expectedOn ?? undefined}>{model.expectedLabel}</time>
        </p>
      ) : null}

      <ol className="mt-8 space-y-4">
        {model.stages.map((stage) => (
          <li key={stage.id} className="flex min-w-0 gap-3" data-stage={stage.id} data-state={stage.state} aria-current={stage.state === "current" ? "step" : undefined}>
            <span
              aria-hidden
              className={
                stage.state === "upcoming" || stage.state === "skipped"
                  ? "mt-1 size-3 shrink-0 rounded-full border border-line"
                  : "mt-1 size-3 shrink-0 rounded-full bg-ink"
              }
            />
            <div className="min-w-0">
              <p className={stage.state === "upcoming" || stage.state === "skipped" ? "font-semibold text-grey" : "font-semibold"}>
                {stage.label}
                <span className="sr-only"> {STATE_LABEL[stage.state]}</span>
              </p>
              {stage.detail ? <p className="text-sm break-words text-grey">{stage.detail}</p> : null}
            </div>
          </li>
        ))}
      </ol>

      <h2 className="mt-10 font-display text-2xl">Items</h2>
      {model.items.length === 0 ? <p className="mt-3 text-sm text-grey">No items on this order.</p> : null}
      {model.items.length > 0 ? (
        <table className="mt-3 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-grey">
              <th className="py-2 pr-3 font-semibold">Item</th>
              <th className="py-2 text-right font-semibold">Qty</th>
            </tr>
          </thead>
          <tbody>
            {model.items.map((item) => (
              <tr key={`${item.name}-${item.quantity}`} className="border-b border-line">
                <td className="py-3 pr-3 break-words">{item.name}</td>
                <td className="py-3 text-right tabular-nums">{item.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {model.photos.length > 0 ? (
        <>
          <h2 className="mt-10 font-display text-2xl">Photos</h2>
          <ul className="mt-3 grid grid-cols-2 gap-2">
            {model.photos.map((photo) => (
              <li key={photo.id} className="min-w-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- 60-second signed URLs must not be cached by the image optimiser */}
                <img src={photo.src} alt={photo.caption || "Checked photo"} className="h-36 w-full rounded-2xl border border-line object-cover" />
                {photo.caption ? <p className="mt-1 text-sm break-words text-grey">{photo.caption}</p> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </main>
  );
}
