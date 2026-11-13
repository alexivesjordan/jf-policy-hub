import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sendPulseEmail, type EmailLogRow } from "../email/send";
import { installStage } from "./stage";
import { accessReminderDue, type AccessReminderCadence } from "./reminders";

const cadence: AccessReminderCadence = { weekly: true, finalDaysBeforeStart: 7 };

function reminder(overrides: Partial<Parameters<typeof accessReminderDue>[0]> = {}) {
  return accessReminderDue(
    {
      bookedOn: "2026-11-01",
      startOn: "2026-12-01",
      today: "2026-11-08",
      submitted: false,
      mediaCount: 0,
      lastReminderOn: null,
      ...overrides,
    },
    cadence,
  );
}

describe("install follow-on", () => {
  it("derives the sales kanban stage and keeps quoting for a later phase", () => {
    assert.equal(installStage({ status: "booked", accessSent: false, accessComplete: false }), "booked");
    assert.equal(installStage({ status: "booked", accessSent: true, accessComplete: false }), "awaiting_access");
    assert.equal(installStage({ status: "booked", accessSent: true, accessComplete: true }), "ready");
    assert.equal(installStage({ status: "completed", accessSent: true, accessComplete: true }), "completed");
    assert.equal(installStage({ status: "booked", accessSent: false, accessComplete: false, quoting: true }), "quoting");
  });

  it("sends a weekly reminder and a final one, then stops", () => {
    assert.equal(reminder({ today: "2026-11-08" }), true);
    assert.equal(reminder({ today: "2026-11-09" }), false);
    assert.equal(reminder({ today: "2026-11-24" }), true);
    assert.equal(reminder({ today: "2026-11-08", lastReminderOn: "2026-11-08" }), false);
    assert.equal(reminder({ today: "2026-12-01" }), false);
    assert.equal(reminder({ today: "2026-12-02" }), false);
    assert.equal(reminder({ today: "2026-11-08", submitted: true, mediaCount: 0 }), true);
    assert.equal(reminder({ today: "2026-11-08", submitted: true, mediaCount: 1 }), false);
  });

  it("logs email without sending when the Resend key is missing", async () => {
    const rows: EmailLogRow[] = [];
    let called = false;
    const result = await sendPulseEmail(
      { to: "customer@example.com", subject: "Access", template: "access_form", text: "Link", html: "<p>Link</p>", installId: "install-1" },
      {
        env: {},
        fetch: async () => {
          called = true;
          return new Response("{}");
        },
        record: async (row) => {
          rows.push(row);
        },
      },
    );
    assert.equal(result.status, "logged");
    assert.equal(called, false);
    assert.equal(rows[0]?.status, "logged");
    assert.equal(rows[0]?.to, "customer@example.com");
  });

  it("sends a preview only to EMAIL_REDIRECT_TO and records the redirect", async () => {
    const rows: EmailLogRow[] = [];
    let deliveredTo = "";
    const result = await sendPulseEmail(
      {
        to: "customer@example.com",
        subject: "Access",
        template: "access_form",
        text: "Link",
        html: "<p>Link</p>",
        attachments: [{ filename: "note.txt", contentBase64: "aGVsbG8=" }],
      },
      {
        env: { RESEND_API_KEY: "re_test", EMAIL_REDIRECT_TO: "qa@jordanfitness.com" },
        fetch: async (_url, init) => {
          deliveredTo = JSON.parse(String(init?.body)).to[0];
          return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
        },
        record: async (row) => {
          rows.push(row);
        },
      },
    );
    assert.equal(deliveredTo, "qa@jordanfitness.com");
    assert.equal(result.status, "redirected");
    assert.equal(rows[0]?.status, "redirected");
    assert.equal(rows[0]?.providerId, "email_1");
    assert.equal(rows[0]?.to, "customer@example.com");
  });
});
