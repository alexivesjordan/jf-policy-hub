import type { KitFollowUp, KitFollowUpLine } from "@/lib/installs/kit-follow-up";

const STATUS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

function label(line: KitFollowUpLine) {
  const name = line.description || line.code || "Item";
  return line.qty ? `${line.qty}× ${name}` : name;
}

export function KitFollowUpPanel({ followUp, plain = false }: { followUp: KitFollowUp | null; plain?: boolean }) {
  if (!followUp || followUp.lines.length === 0) return null;
  const installed = followUp.lines.filter((line) => line.fulfilment === "installed");
  const waiting = followUp.lines.filter((line) => line.fulfilment === "to_follow");
  const body = (
    <>
      <h2 className={plain ? "text-sm font-semibold uppercase tracking-wide text-grey" : "font-display text-2xl"}>Kit</h2>
      {installed.length > 0 ? <LineList title="Installed" lines={installed} /> : null}
      {waiting.length > 0 ? <LineList title="To follow" lines={waiting} /> : null}
      {followUp.task ? (
        <p className="mt-3 font-semibold">{followUp.task.title} · {STATUS[followUp.task.status] ?? followUp.task.status}</p>
      ) : null}
    </>
  );
  if (plain) return <section className="space-y-2">{body}</section>;
  return <section className="rounded-3xl border border-line bg-card px-6 py-5 text-sm">{body}</section>;
}

function LineList({ title, lines }: { title: string; lines: KitFollowUpLine[] }) {
  return (
    <div className="mt-3">
      <h3 className="font-semibold">{title}</h3>
      <ul className="mt-1 space-y-1">
        {lines.map((line, index) => <li key={`${line.code}-${index}`}>{label(line)}</li>)}
      </ul>
    </div>
  );
}
