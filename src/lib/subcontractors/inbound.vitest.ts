import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inboundDomain, parseInboundEvent, replyAddress, verifyResendSignature } from "@/lib/subcontractors/inbound";

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
  });
});
