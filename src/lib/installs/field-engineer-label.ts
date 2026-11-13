/** An unlinked Installs login is already a field engineer. Only the office option means office. */
export function fieldEngineerBlankLabel(onInstallsTeam: boolean, linked: boolean, office: boolean) {
  if (onInstallsTeam && !linked && !office) return "Not linked yet";
  return "Not a field engineer";
}
