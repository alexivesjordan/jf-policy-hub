import { sideBySide, type DiffKind } from "@/lib/diff";
import { cn } from "@/lib/utils";

function cellClass(kind: DiffKind) {
  return cn(
    "min-h-8 whitespace-pre-wrap break-words px-3 py-1.5",
    kind === "add" && "bg-white/10",
    kind === "remove" && "bg-red/20",
    kind === "empty" && "bg-paper/60 text-transparent",
  );
}

export function DiffView({
  before,
  after,
  leftLabel,
  rightLabel,
}: {
  before: string;
  after: string;
  leftLabel: string;
  rightLabel: string;
}) {
  if (!before.trim() && !after.trim()) {
    return <p className="text-sm text-ink/70">Both copies are empty.</p>;
  }

  const rows = sideBySide(before, after);
  if (rows.length === 0) {
    return <p className="text-sm text-ink/70">There is no difference to show.</p>;
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-field">
      <div className="hidden bg-card text-sm font-semibold text-white lg:grid lg:grid-cols-2">
        <div className="px-3 py-2">{leftLabel}</div>
        <div className="border-l border-white/15 px-3 py-2">{rightLabel}</div>
      </div>
      <div className="max-h-[34rem] overflow-auto">
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-1 border-t border-line text-sm lg:grid-cols-2">
            <div className={cellClass(row.left.kind)}>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-grey lg:hidden">
                {leftLabel}
              </span>
              {row.left.text || " "}
            </div>
            <div className={cn(cellClass(row.right.kind), "lg:border-l lg:border-line")}>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-grey lg:hidden">
                {rightLabel}
              </span>
              {row.right.text || " "}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
