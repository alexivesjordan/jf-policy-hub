export type KitFollowUpLine = {
  code: string;
  description: string;
  qty: string;
  fulfilment: "installed" | "to_follow";
};

export type KitFollowUpTask = {
  id: string;
  title: string;
  status: string;
  body: string | null;
};

export type KitFollowUp = {
  lines: KitFollowUpLine[];
  task: KitFollowUpTask | null;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function kitFollowUpFrom(value: unknown): KitFollowUp | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { lines?: unknown; followUp?: unknown };
  const lines = Array.isArray(row.lines)
    ? row.lines.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const line = item as { code?: unknown; description?: unknown; qty?: unknown; fulfilment?: unknown };
        if (line.fulfilment !== "installed" && line.fulfilment !== "to_follow") return [];
        const qty = typeof line.qty === "number" ? String(line.qty) : text(line.qty);
        return [{
          code: text(line.code),
          description: text(line.description),
          qty,
          fulfilment: line.fulfilment,
        }];
      })
    : [];
  const taskRow = row.followUp && typeof row.followUp === "object" ? row.followUp as { id?: unknown; title?: unknown; status?: unknown; body?: unknown } : null;
  const task = taskRow && text(taskRow.id) && text(taskRow.title)
    ? { id: text(taskRow.id), title: text(taskRow.title), status: text(taskRow.status) || "open", body: text(taskRow.body) || null }
    : null;
  if (lines.length === 0 && !task) return null;
  return { lines, task };
}
