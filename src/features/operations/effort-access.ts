export function canSaveSkuEffort(profile: { workspace_role?: string | null; levels?: { operations?: string | null } | null }) {
  return profile.workspace_role === "owner" || profile.workspace_role === "admin" || profile.levels?.operations === "edit";
}

/** Empty minutes clear the stored build and return the row to No build time set. */
export function skuEffortSavePlan(input: { needsAssembly: "yes" | "no" | "unknown"; crew: number | null; minutes: number | null }) {
  const clearMinutes = input.minutes == null;
  const clearCrew = input.crew == null;
  return {
    clearCrew,
    clearMinutes,
    status: clearMinutes ? "suggested" as const : "confirmed" as const,
    needsAssembly: clearMinutes ? "unknown" as const : input.needsAssembly,
  };
}
