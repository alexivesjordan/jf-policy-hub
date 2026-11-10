export const ACCESS_LEVELS = ["none", "view", "edit"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const WORKSPACE_ROLES = ["owner", "admin", "manager", "member", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

const rank: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2 };

export function mostPermissive(levels: AccessLevel[]): AccessLevel {
  return levels.reduce<AccessLevel>((best, level) => (rank[level] > rank[best] ? level : best), "none");
}

/** Owner and admin raise every module to edit. Viewer caps at view. Manager raises a blank grant to view. */
export function applyWorkspaceRole(role: WorkspaceRole, teamLevel: AccessLevel): AccessLevel {
  if (role === "owner" || role === "admin") return "edit";
  if (role === "viewer") return teamLevel === "none" ? "none" : "view";
  if (role === "manager") return teamLevel === "none" ? "view" : teamLevel;
  return teamLevel;
}

export function resolveModuleAccess(input: {
  accessMode: "follow" | "custom";
  role: WorkspaceRole;
  teamGrants: AccessLevel[];
  custom: AccessLevel | null;
}): AccessLevel {
  if (input.accessMode === "custom") return input.custom ?? "none";
  return applyWorkspaceRole(input.role, mostPermissive(input.teamGrants));
}

export function allows(level: AccessLevel | undefined, need: "view" | "edit") {
  if (!level) return false;
  if (need === "view") return level === "view" || level === "edit";
  return level === "edit";
}
