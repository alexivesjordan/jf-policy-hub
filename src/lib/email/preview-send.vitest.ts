import { describe, expect, it } from "vitest";
import { sendPulseEmail, type EmailIo } from "@/lib/email/send";

function io(env: Record<string, string | undefined>): EmailIo & { calls: number; rows: { status: string; to: string }[] } {
  const rows: { status: string; to: string }[] = [];
  return {
    env,
    calls: 0,
    rows,
    fetch: async () => {
      throw new Error("fetch should be counted by the wrapper");
    },
    async record(row) {
      rows.push({ status: row.status, to: row.to });
    },
  };
}

describe("non-production email", () => {
  it("logs and does not call Resend when the preview has no redirect", async () => {
    let calls = 0;
    const harness = io({ RESEND_API_KEY: "re_live_looking", VERCEL_ENV: "preview" });
    harness.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ id: "should-not-send" }), { status: 200 });
    };
    const result = await sendPulseEmail({
      to: "customer@example.com",
      subject: "Site access",
      template: "access_form",
      text: "Hello",
      html: "<p>Hello</p>",
    }, harness);
    expect(result.status).toBe("logged");
    expect(calls).toBe(0);
    expect(harness.rows[0]?.to).toBe("customer@example.com");
  });

  it("redirects a preview send and does not use the customer address as the recipient", async () => {
    let delivered = "";
    const harness = io({ RESEND_API_KEY: "re_test", VERCEL_ENV: "preview", EMAIL_REDIRECT_TO: "qa@jordanfitness.com" });
    harness.fetch = async (_url, init) => {
      delivered = String(init?.body ?? "");
      return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
    };
    const result = await sendPulseEmail({
      to: "customer@example.com",
      subject: "Site access",
      template: "access_form",
      text: "Hello",
      html: "<p>Hello</p>",
      replyTo: "rep@jordanfitness.com",
    }, harness);
    expect(result.status).toBe("redirected");
    expect(delivered).toContain("qa@jordanfitness.com");
    expect(delivered).not.toContain("customer@example.com");
  });
});
