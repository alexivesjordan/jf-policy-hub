import { connection } from "next/server";
import { suggestQuotedPrice } from "@/lib/subcontractors/price";
import { fetchReceivedText, inboundDomain, parseInboundEvent, verifyResendSignature } from "@/lib/subcontractors/inbound";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  await connection();
  const raw = await request.text();
  const verified = verifyResendSignature({
    secret: process.env.RESEND_WEBHOOK_SECRET?.trim() ?? "",
    payload: raw,
    id: request.headers.get("svix-id") ?? "",
    timestamp: request.headers.get("svix-timestamp") ?? "",
    signature: request.headers.get("svix-signature") ?? "",
  });
  if (!verified) return Response.json({ ok: false, error: "Signature rejected" }, { status: 400 });

  let parsed: ReturnType<typeof parseInboundEvent>;
  try {
    parsed = parseInboundEvent(raw, inboundDomain(process.env));
  } catch {
    return Response.json({ ok: false, error: "Could not read that event" }, { status: 400 });
  }
  if (parsed.kind === "ignore") return Response.json({ ok: true, ignored: true });
  if (!parsed.token) return Response.json({ ok: true, matched: false });

  let text = parsed.text;
  let unavailable = false;
  if (!text) {
    const fetched = await fetchReceivedText(parsed.emailId, { env: process.env, fetch: globalThis.fetch });
    text = fetched.text;
    unavailable = fetched.unavailable;
  }
  const suggestion = await suggestQuotedPrice(text, { env: process.env, fetch: globalThis.fetch });
  const admin = createAdminClient();
  if (!admin) return Response.json({ ok: false }, { status: 500 });
  const saved = await admin.rpc("subcontractor_record_reply", {
    p_token: parsed.token,
    p_from: parsed.from,
    p_to: parsed.recipients[0] ?? "",
    p_subject: parsed.subject,
    p_body: unavailable ? null : text,
    p_provider: parsed.emailId || null,
    p_suggested: unavailable ? null : suggestion.amount,
    p_body_unavailable: unavailable,
  });
  if (saved.error) return Response.json({ ok: false }, { status: 500 });
  return Response.json({ ok: true, matched: Boolean((saved.data as { matched?: boolean } | null)?.matched) });
}
