import { connection } from "next/server";
import { pulseRpcError, readJson } from "@/lib/pulse/http";
import { createTaskSchema } from "@/lib/pulse/schema";
import { pulseSession } from "@/lib/pulse/session";

export async function GET() {
  await connection();
  const session = await pulseSession();
  if (!session.ok) return session.response;

  const { data, error } = await session.supabase.rpc("orbit_list_tasks");
  if (error) return pulseRpcError(error, "Could not load tasks.");
  return Response.json({ tasks: data ?? [] });
}

export async function POST(request: Request) {
  await connection();
  const session = await pulseSession();
  if (!session.ok) return session.response;

  const parsed = createTaskSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return Response.json({ error: "Check the task and try again." }, { status: 400 });
  }

  const { data, error } = await session.supabase.rpc("orbit_create_task", {
    p_kind: parsed.data.kind,
    p_title: parsed.data.title,
    p_body: parsed.data.body ?? null,
    p_priority: parsed.data.priority ?? "normal",
    p_due_at: parsed.data.due_at ?? null,
    p_assignee_id: parsed.data.assignee_id ?? null,
    p_entity_schema: parsed.data.entity_schema ?? null,
    p_entity_table: parsed.data.entity_table ?? null,
    p_entity_id: parsed.data.entity_id ?? null,
  });
  if (error) return pulseRpcError(error, "Could not create that task.");
  return Response.json({ task: data }, { status: 201 });
}
