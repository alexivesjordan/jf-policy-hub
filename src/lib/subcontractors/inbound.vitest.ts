import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fetchReceivedText, inboundDomain, parseInboundEvent, replyAddress, verifyResendSignature } from "@/lib/subcontractors/inbound";

const rawSecret = "pulse-test-secret";
const secret = `whsec_${Buffer.from(rawSecret).toString("base64")}`;

function sign(payload: string, timestamp: string, id = "msg_test") {
  const digest = createHmac("sha256", Buffer.from(rawSecret)).update(`${id}.${timestamp}.${payload}`).digest("base64");
  return { id, timestamp, signature: `v1,${digest}` };
}

describe("inbound webhook", () => {
  const now = 1_700_000_000;
  const payload = JSON.stringify({
    type: "email.received",
    data: {
      email_id: "email-1",
      from: "chris@draigfitness.com",
      to: ["q-abc123abc123abc123abc123@replies.jordanfitness.com"],
      subject: "Re: Install quote",
    },
  });

  it("accepts a current signature and rejects a bad one or a replay", () => {
    const good = sign(payload, String(now));
    expect(verifyResendSignature({ secret, payload, ...good, nowSeconds: now })).toBe(true);
    expect(verifyResendSignature({ secret, payload, ...good, signature: "v1,bm90LXRoZS1zaWduYXR1cmU=", nowSeconds: now })).toBe(false);
    expect(verifyResendSignature({ secret, payload, ...good, nowSeconds: now + 301 })).toBe(false);
    expect(verifyResendSignature({ secret: "", payload, ...good, nowSeconds: now })).toBe(false);
  });

  it("reads the reply token and ignores other events", () => {
    const parsed = parseInboundEvent(payload, inboundDomain({}));
    expect(parsed.kind).toBe("email");
    if (parsed.kind === "email") expect(parsed.token).toBe("abc123abc123abc123abc123");
    expect(replyAddress("abc123abc123abc123abc123", "replies.jordanfitness.com")).toBe("q-abc123abc123abc123abc123@replies.jordanfitness.com");
    expect(parseInboundEvent(JSON.stringify({ type: "email.sent" }), "replies.jordanfitness.com").kind).toBe("ignore");
    const withBody = parseInboundEvent(JSON.stringify({ type: "email.received", data: { text: "Price £10", to: ["q-abc123abc123abc123abc123@replies.jordanfitness.com"] } }), "replies.jordanfitness.com");
    if (withBody.kind === "email") expect(withBody.text).toBe("Price £10");
  });

  it("does not use the sending key to read a received body", async () => {
    let called = false;
    const missing = await fetchReceivedText("email-1", {
      env: { RESEND_API_KEY: "re_send_only" },
      fetch: async () => {
        called = true;
        return new Response("{}");
      },
    });
    expect(missing.unavailable).toBe(true);
    expect(called).toBe(false);
    const fetched = await fetchReceivedText("email-1", {
      env: { RESEND_INBOUND_API_KEY: "re_inbound" },
      fetch: async (_url, init) => {
        expect(String((init?.headers as Record<string, string>).authorization)).toContain("re_inbound");
        return new Response(JSON.stringify({ text: "£900" }), { status: 200 });
      },
    });
    expect(fetched).toEqual({ text: "£900", unavailable: false });
  });
});
