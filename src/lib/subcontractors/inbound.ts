import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export function newReplyToken() {
  return randomBytes(12).toString("hex");
}

export function verifyResendSignature(input: {
  secret: string;
  payload: string;
  id: string;
  timestamp: string;
  signature: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}) {
  const secret = input.secret.trim();
  const stamp = Number(input.timestamp);
  if (!secret || !input.id || !input.signature || !Number.isFinite(stamp)) return false;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - stamp) > (input.toleranceSeconds ?? 300)) return false;
  const encoded = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const key = Buffer.from(encoded, "base64");
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${input.id}.${input.timestamp}.${input.payload}`).digest("base64");
  return input.signature
    .split(/\s+/)
    .map((part) => (part.startsWith("v1,") ? part.slice(3) : part))
    .filter(Boolean)
    .some((part) => safeEqual(part, expected));
}

export function replyTokenFromAddress(address: string, domain: string) {
  const host = domain.trim().toLowerCase().replace(/^@/, "");
  const email = address.trim().toLowerCase().match(/<([^>]+)>/)?.[1] ?? address.trim().toLowerCase();
  const match = new RegExp(`^q-([a-z0-9]{16,64})@${host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`).exec(email);
  return match?.[1] ?? null;
}

export function parseInboundEvent(payload: string, domain: string): { kind: "ignore" } | { kind: "email"; emailId: string; from: string; subject: string; token: string | null; recipients: string[] } {
  const event = JSON.parse(payload) as {
    type?: string;
    data?: {
      email_id?: string;
      from?: string;
      to?: string[];
      cc?: string[];
      bcc?: string[];
      received_for?: string[];
      subject?: string;
    };
  };
  if (event.type !== "email.received") return { kind: "ignore" };
  const data = event.data ?? {};
  const recipients = [...(data.to ?? []), ...(data.cc ?? []), ...(data.bcc ?? []), ...(data.received_for ?? [])];
  const token = recipients.map((address) => replyTokenFromAddress(address, domain)).find(Boolean) ?? null;
  return {
    kind: "email",
    emailId: String(data.email_id ?? ""),
    from: String(data.from ?? ""),
    subject: String(data.subject ?? ""),
    token,
    recipients,
  };
}

export async function fetchReceivedText(
  emailId: string,
  io: { env: Record<string, string | undefined>; fetch: typeof fetch },
) {
  const key = io.env.RESEND_API_KEY?.trim() ?? "";
  if (!key || !emailId) return "";
  const response = await io.fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { authorization: `Bearer ${key}`, accept: "application/json" },
  });
  if (!response.ok) return "";
  const body = (await response.json()) as { text?: string | null; html?: string | null };
  return String(body.text ?? body.html ?? "");
}

export function inboundDomain(env: Record<string, string | undefined>) {
  const domain = env.RESEND_INBOUND_DOMAIN?.trim() || "replies.jordanfitness.com";
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return "replies.jordanfitness.com";
  return domain.toLowerCase();
}

export function replyAddress(token: string, domain: string) {
  return `q-${token}@${domain}`;
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
