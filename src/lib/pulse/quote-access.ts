/** Crew plans, labour, vehicle costs, and internal cost. A sales rep does not see these. An install lead with operations edit does. */
export function seesInstallBreakdown(input: {
  isOwner?: boolean;
  opsRole?: string | null;
  workspaceRole?: string | null;
  operations?: string | null;
}) {
  if (input.isOwner) return true;
  if (input.workspaceRole === "owner" || input.workspaceRole === "admin") return true;
  if (input.operations === "edit") return true;
  return input.opsRole === "install_lead" || input.opsRole === "admin_owner";
}
