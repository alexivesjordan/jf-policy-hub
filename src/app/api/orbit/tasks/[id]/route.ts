import { connection } from "next/server";
import { z } from "zod";
import { orbitRpcError, readJson } from "@/lib/orbit/http";
import { updateTaskSchema } from "@/lib/orbit/schema";
import { orbitSession } from "@/lib/orbit/session";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  await connection();
  const session = await orbitSession();
  if (!session.ok) return session.response;

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: "That task could not be found." }, { status: 404 });
  }
  const parsed = updateTaskSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return Response.json({ error: "Check the task and try again." }, { status: 400 });
  }

  const { data, error } = await session.supabase.rpc("orbit_update_task", {
    p_task_id: id,
    p_status: parsed.data.status ?? null,
    p_title: parsed.data.title ?? null,
    p_body: parsed.data.body ?? null,
    p_priority: parsed.data.priority ?? null,
    p_due_at: parsed.data.due_at ?? null,
    p_assignee_id: parsed.data.assignee_id ?? null,
  });
  if (error) return orbitRpcError(error, "Could not update that task.");
  return Response.json({ task: data });
}
