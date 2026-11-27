/** A new draft token makes New visit a different page from the form just saved. */
export function visitFormInstanceKey(visitId: string | null | undefined, draft: string | null | undefined) {
  if (visitId) return `visit:${visitId}`;
  const token = draft?.trim();
  return token ? `new:${token}` : "new";
}

export function newVisitHref(day: string, draft: string, personId?: string) {
  const params = new URLSearchParams();
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) params.set("on", day);
  if (personId) params.set("person", personId);
  params.set("draft", draft);
  return `/service/visits/new?${params.toString()}`;
}

export function planVisitHref(planId: string, day: string, draft: string) {
  const params = new URLSearchParams();
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) params.set("on", day);
  params.set("plan", planId);
  params.set("draft", draft);
  return `/service/visits/new?${params.toString()}`;
}
