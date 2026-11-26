import "server-only";

import { requireLogisticsApi } from "@/features/logistics/commercial-invoice/access";

export async function logisticsGate() {
  const gate = await requireLogisticsApi();
  if (gate.error || !gate.profile) return { profile: null, response: Response.json({ error: gate.error ?? "Sign in required." }, { status: gate.status }) };
  return { profile: gate.profile, response: null };
}

export function apiError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  const safe = message && message.length < 180 && !/key|token|password|supabase|stack|sql/i.test(message) ? message : fallback;
  const status = /not found|not a declarable/i.test(safe) ? 404 : /unavailable|not available/i.test(safe) ? 503 : 422;
  return Response.json({ error: safe }, { status, headers: { "Cache-Control": "no-store" } });
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
