export type CaseRoute = "manager" | "director_only";

export function caseAboutManager(input: { route: CaseRoute; subjectHasReports: boolean }) {
  return input.route === "director_only" || input.subjectHasReports;
}

/** Directors, plus the opener, unless they sit in the subject's management chain. */
export function caseOpeningMembers(input: {
  route: CaseRoute;
  subjectHasReports: boolean;
  openerId: string;
  directorIds: string[];
  managerId: string | null;
  chainIds: string[];
}) {
  const blocked = new Set(input.chainIds);
  if (input.managerId) blocked.add(input.managerId);
  const proposed = caseAboutManager(input) ? [...input.directorIds, input.openerId] : [input.openerId];
  const members = [...new Set(proposed)].filter((id) => !blocked.has(id));
  return { members, blocked: [...blocked] };
}

export function canAddCaseMember(input: {
  route: CaseRoute;
  subjectHasReports: boolean;
  profileId: string;
  managerId: string | null;
  chainIds: string[];
}) {
  if (!caseAboutManager(input)) return true;
  if (input.profileId === input.managerId) return false;
  return !input.chainIds.includes(input.profileId);
}
