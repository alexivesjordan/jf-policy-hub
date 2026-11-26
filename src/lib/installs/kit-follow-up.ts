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
  const lines: KitFollowUpLine[] = [];
  if (Array.isArray(row.lines)) {
    for (const item of row.lines) {
      if (!item || typeof item !== "object") continue;
      const line = item as { code?: unknown; description?: unknown; qty?: unknown; fulfilment?: unknown };
      const fulfilment = line.fulfilment === "installed" || line.fulfilment === "to_follow" ? line.fulfilment : null;
      if (!fulfilment) continue;
      const qty = typeof line.qty === "number" ? String(line.qty) : text(line.qty);
      lines.push({
        code: text(line.code),
        description: text(line.description),
        qty,
        fulfilment,
      });
    }
  }
  const taskRow = row.followUp && typeof row.followUp === "object" ? row.followUp as { id?: unknown; title?: unknown; status?: unknown; body?: unknown } : null;
  const task = taskRow && text(taskRow.id) && text(taskRow.title)
    ? { id: text(taskRow.id), title: text(taskRow.title), status: text(taskRow.status) || "open", body: text(taskRow.body) || null }
    : null;
  if (lines.length === 0 && !task) return null;
  return { lines, task };
}
