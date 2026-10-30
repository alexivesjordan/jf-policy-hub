import "server-only";

import { timingSafeEqual } from "crypto";

export function researchAgentAuthorised(request: Request) {
  const expected = process.env.RESEARCH_AGENT_TOKEN ?? "";
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!expected || !token) return false;

  const provided = Buffer.from(token);
  const actual = Buffer.from(expected);
  if (provided.length !== actual.length) return false;
  return timingSafeEqual(provided, actual);
}
