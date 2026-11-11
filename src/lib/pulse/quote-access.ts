/** Crew plans, labour, vehicle costs, and internal cost. Owners and admins only. */
export function seesInstallBreakdown(input: {
  isOwner?: boolean;
  opsRole?: string | null;
  workspaceRole?: string | null;
}) {
  if (input.isOwner) return true;
  return input.workspaceRole === "owner" || input.workspaceRole === "admin";
}
