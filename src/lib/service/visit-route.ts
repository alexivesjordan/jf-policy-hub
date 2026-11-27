const VISIT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VisitAudience = "engineer" | "office";

/** Field engineers open the job page. Office and admin keep the booking form. */
export function visitAudience(fieldRole: string): VisitAudience {
  return fieldRole === "engineer" ? "engineer" : "office";
}

export function engineerJobPath(visitId: string) {
  return `/service/job/${visitId}`;
}

export function plannerVisitPath(visitId: string) {
  return `/service/visits/${visitId}`;
}

export function serviceVisitHref(audience: VisitAudience, visitId: string) {
  return audience === "engineer" ? engineerJobPath(visitId) : plannerVisitPath(visitId);
}

function visitIdFromPath(path: string) {
  const match = /^\/service\/(?:visits|job|day)\/([^/?#]+)/.exec(path);
  if (!match || match[1] === "new" || !VISIT_ID.test(match[1])) return null;
  return match[1];
}

/** Planner, job, and My day links open the page this person should see. Other links stay put. */
export function destinationForVisitLink(audience: VisitAudience, href: string | null) {
  if (!href) return href;
  const absolute = /^https?:\/\//i.test(href);
  let path = href;
  let origin = "";
  let search = "";
  if (absolute) {
    try {
      const url = new URL(href);
      origin = url.origin;
      path = url.pathname;
      search = url.search;
    } catch {
      return href;
    }
  } else {
    const query = href.indexOf("?");
    if (query >= 0) {
      search = href.slice(query);
      path = href.slice(0, query);
    }
  }
  const id = visitIdFromPath(path);
  if (!id) return href;
  const next = serviceVisitHref(audience, id);
  return absolute ? `${origin}${next}${search}` : `${next}${search}`;
}

/** An engineer who opens the booking form is sent to the job page. */
export function engineerPlannerRedirect(fieldRole: string, path: string) {
  if (visitAudience(fieldRole) !== "engineer") return null;
  const id = visitIdFromPath(path.startsWith("/service/visits/") ? path : "");
  return id ? engineerJobPath(id) : null;
}
