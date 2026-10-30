import { connection } from "next/server";
import { researchAgentAuthorised } from "@/features/amendments/agent-auth";
import { agentAmendmentSchema } from "@/features/amendments/schema";
import { dispatchNotificationEmails } from "@/features/notifications/dispatch";
import { messageFromError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AgentResult } from "@/lib/types";

export async function POST(request: Request) {
  await connection();

  if (!researchAgentAuthorised(request)) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return Response.json({ error: "Server is not configured." }, { status: 500 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Send a JSON body." }, { status: 400 });
  }

  if (json && typeof json === "object") {
    const record = json as Record<string, unknown>;
    if (record.effective_date === "") record.effective_date = null;
    if (record.legal_change_description === "") record.legal_change_description = null;
    if (record.jurisdiction === "") record.jurisdiction = null;
    if (Array.isArray(record.source_urls)) {
      record.source_urls = record.source_urls.filter((item) => typeof item === "string" && item.trim().length > 0);
    }
  }

  const parsed = agentAmendmentSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid suggestion.",
        details: parsed.error.issues.map((issue) => issue.message),
      },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const { data, error } = await admin.rpc("submit_agent_amendment", {
    p_policy_id: input.policy_id,
    p_proposed_content: input.proposed_content,
    p_summary: input.summary,
    p_legal_change_description: input.legal_change_description ?? null,
    p_source_urls: input.source_urls,
    p_jurisdiction: input.jurisdiction ?? null,
    p_effective_date: input.effective_date ?? null,
    p_severity: input.severity,
  });

  if (error || !data) {
    const message = messageFromError(error, "Could not save that suggestion.");
    const status = message.toLowerCase().includes("could not be found") ? 404 : 400;
    return Response.json({ error: message }, { status });
  }

  const result = data as AgentResult;
  await dispatchNotificationEmails(result);

  return Response.json(
    { id: result.id, status: result.status, policy_id: result.policy_id ?? input.policy_id },
    { status: result.status === "auto-applied" ? 201 : 202 },
  );
}
