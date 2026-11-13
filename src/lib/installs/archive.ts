const DAY_MS = 24 * 60 * 60 * 1000;

export type ArchiveRow = {
  status: string;
  completedAt: string | null;
  archivedAt: string | null;
  restoredAt: string | null;
};

/** A completed install archives 24 hours after that completion, unless it was restored afterwards. */
export function archiveDue(row: ArchiveRow, now: Date) {
  if (row.archivedAt) return false;
  if (row.status !== "completed" || !row.completedAt) return false;
  const completed = Date.parse(row.completedAt);
  if (!Number.isFinite(completed)) return false;
  if (now.getTime() - completed < DAY_MS) return false;
  if (row.restoredAt) {
    const restored = Date.parse(row.restoredAt);
    if (Number.isFinite(restored) && completed <= restored) return false;
  }
  return true;
}

export function installsSurface(view: string): "board" | "calendar" {
  if (view === "calendar" || view === "month" || view === "week") return "calendar";
  return "board";
}

export function calendarSpan(view: string): "month" | "week" {
  return view === "week" ? "week" : "month";
}
