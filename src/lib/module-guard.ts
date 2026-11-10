/** Route-guard helper for office context returned by orbit_office_context. */
export function hasLevel(
  level: string | null | undefined,
  need: "view" | "edit",
  isOwner = false,
) {
  if (isOwner) return true;
  if (need === "view") return level === "view" || level === "edit";
  return level === "edit";
}
