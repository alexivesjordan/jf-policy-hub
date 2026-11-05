import { connection } from "next/server";
import { orbitRpcError, readJson } from "@/lib/orbit/http";
import { tokenRoundtripSchema } from "@/lib/orbit/schema";
import { orbitSession, requireOpsOwner } from "@/lib/orbit/session";
import { createTokenLink, resolveTokenHash, resolveTokenLink, revokeTokenLink } from "@/lib/orbit/tokens";

/**
 * Throwaway M0 check. It is not the access form or the customer portal.
 * The plaintext token is never written to the log. The roundtrip action
 * does not return it.
 */
export async function POST(request: Request) {
  await connection();
  const session = await orbitSession();
  if (!session.ok) return session.response;

  const owner = await requireOpsOwner(session.supabase);
  if (!owner.ok) return orbitRpcError(owner.error, "Could not check owner access.");
  if (!owner.owner) {
    return Response.json({ error: "Only the owner can run the token check." }, { status: 403 });
  }

  const parsed = tokenRoundtripSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return Response.json({ error: "Check the request and try again." }, { status: 400 });
  }

  if (parsed.data.action === "resolve") {
    try {
      const resolved = await resolveTokenLink(parsed.data.token);
      if (!resolved) return Response.json({ error: "That link is not valid." }, { status: 404 });
      return Response.json({
        ok: true,
        purpose: resolved.purpose,
        entity_schema: resolved.entity_schema,
        entity_table: resolved.entity_table,
        entity_id: resolved.entity_id,
      });
    } catch {
      return Response.json({ error: "Could not resolve that link." }, { status: 500 });
    }
  }

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  let created: Awaited<ReturnType<typeof createTokenLink>> | null = null;
  try {
    created = await createTokenLink({
      purpose: parsed.data.purpose,
      entitySchema: parsed.data.entity_schema,
      entityTable: parsed.data.entity_table,
      entityId: parsed.data.entity_id,
      expiresAt,
    });
    const resolved = await resolveTokenHash(created.hashHex);
    const matched =
      resolved?.entity_id === parsed.data.entity_id &&
      resolved.purpose === parsed.data.purpose &&
      resolved.entity_schema === parsed.data.entity_schema &&
      resolved.entity_table === parsed.data.entity_table;

    return Response.json({
      ok: true,
      matched,
      purpose: resolved?.purpose ?? null,
      entity_schema: resolved?.entity_schema ?? null,
      entity_table: resolved?.entity_table ?? null,
      entity_id: resolved?.entity_id ?? null,
    });
  } catch {
    return Response.json({ error: "Could not complete the token check." }, { status: 500 });
  } finally {
    if (created) await revokeTokenLink(created.id);
  }
}
