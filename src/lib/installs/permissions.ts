/**
 * Field access.
 * Admins see every install. Operations editors see every install unless they are
 * linked to an installer or helper resource — those people are engineers and
 * only see installs reserved to them. A subcontractor token opens one install.
 */
export type VisitRole = "admin" | "ops" | "engineer" | "other";

export function visitRole(input: { isAdmin: boolean; hasOperationsEdit: boolean; linkedFieldResource: boolean }): VisitRole {
  if (input.isAdmin) return "admin";
  if (input.linkedFieldResource) return "engineer";
  if (input.hasOperationsEdit) return "ops";
  return "other";
}

export function canSeeInstall(input: { role: VisitRole; userId: string | null; assigneeIds: readonly string[] }) {
  if (input.role === "admin" || input.role === "ops") return true;
  if (input.role === "engineer" && input.userId != null && input.assigneeIds.includes(input.userId)) return true;
  return false;
}

export function canCompleteInstall(input: { role: VisitRole; userId: string | null; assigneeIds: readonly string[] }) {
  return canSeeInstall(input);
}

export function tokenCanComplete(tokenInstallId: string | null | undefined, installId: string) {
  return Boolean(tokenInstallId) && tokenInstallId === installId;
}

export function visibleJobs<T extends { id: string; assigneeIds: readonly string[] }>(
  jobs: readonly T[],
  actor: { role: VisitRole; userId: string | null },
) {
  return jobs.filter((job) => canSeeInstall({ role: actor.role, userId: actor.userId, assigneeIds: job.assigneeIds }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A direct storage upload for a job may only land under that install's id path. */
export function pathBelongsToInstall(installId: string, path: string) {
  if (!UUID.test(installId)) return false;
  return new RegExp(`^ops/${installId}/[0-9a-f-]{36}\\.(jpg|pdf)$`, "i").test(path) && !path.includes("..");
}
