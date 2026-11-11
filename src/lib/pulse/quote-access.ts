/** Who sees the install breakdown. A sales rep sees prices only. */
export function seesInstallBreakdown(input: {
  isOwner?: boolean;
  opsRole?: string | null;
  workspaceRole?: string | null;
}) {
  if (input.isOwner) return true;
  if (input.workspaceRole === "owner" || input.workspaceRole === "admin") return true;
  return input.opsRole === "admin_owner" || input.opsRole === "install_lead";
}
