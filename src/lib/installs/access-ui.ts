export const ACCESS_CHIPS = ["Not sent", "Sent", "Submitted"] as const;
export type AccessChip = (typeof ACCESS_CHIPS)[number];

export const KANBAN_COLUMNS = [
  ["quoting", "Quoting"],
  ["booked", "Booked"],
  ["awaiting_access", "Awaiting access info"],
  ["ready", "Ready"],
  ["completed", "Completed"],
] as const;

export function accessChip(access: {
  sentAt?: string | null;
  submittedAt?: string | null;
  mediaCount?: number | null;
} | null | undefined): AccessChip {
  if (access?.submittedAt) return "Submitted";
  if (access?.sentAt) return "Sent";
  return "Not sent";
}

/** A short charges list cannot be scrolled, so the terms are already read. */
export function termsBoxReady(scrollHeight: number, clientHeight: number, scrolled: boolean) {
  if (scrollHeight <= clientHeight + 12) return true;
  return scrolled;
}

export function kanbanColumn(stage: unknown) {
  const value = String(stage ?? "");
  return KANBAN_COLUMNS.some(([id]) => id === value) ? value : "booked";
}
