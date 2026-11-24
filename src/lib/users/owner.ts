export function ownerLabel(name: string | null | undefined) {
  const trimmed = name?.trim() ?? "";
  return trimmed && trimmed !== "Unassigned" ? trimmed : "Unassigned";
}

export function onlyUnassigned<T extends { ownerUserId?: string | null }>(rows: T[], enabled: boolean) {
  if (!enabled) return rows;
  return rows.filter((row) => !row.ownerUserId);
}
