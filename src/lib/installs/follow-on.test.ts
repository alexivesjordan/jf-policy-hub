import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sendPulseEmail, type EmailLogRow } from "../email/send";
import { canManageInstall } from "./access-auth";
import { installStage } from "./stage";
import { accessReminderDue, type AccessReminderCadence } from "./reminders";
import { ACCESS_VIDEO_MAX_BYTES, accessMediaBytesMatch, planAccessMediaUpload, readStoredObjectHead, storedAccessMediaOk } from "../pulse/access-upload";
import type { Profile } from "../types";

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
    assert.equal(installStage({ status: "completed", accessSent: true, accessComplete: false }), "completed");
    assert.equal(installStage({ status: "booked", accessSent: false, accessComplete: false, quoting: true }), "quoting");
  });

  it("sends a weekly reminder, catches a missed day, and stops once the form is submitted even with no photos", () => {
    assert.equal(reminder({ today: "2026-11-08" }), true);
    assert.equal(reminder({ today: "2026-11-09" }), true);
    assert.equal(reminder({ today: "2026-11-09", lastReminderOn: "2026-11-08" }), false);
    assert.equal(reminder({ today: "2026-11-16", lastReminderOn: "2026-11-08" }), true);
    assert.equal(reminder({ today: "2026-11-24" }), true);
    assert.equal(reminder({ today: "2026-11-26", lastReminderOn: "2026-11-15" }), true);
    assert.equal(reminder({ today: "2026-11-25", lastReminderOn: "2026-11-24" }), false);
    assert.equal(reminder({ today: "2026-12-01" }), false);
    assert.equal(reminder({ today: "2026-12-02" }), false);
    assert.equal(reminder({ today: "2026-11-08", submitted: true, mediaCount: 0 }), false);
    assert.equal(reminder({ today: "2026-11-08", submitted: true, mediaCount: 1 }), false);
  });

  it("lets the owning rep, operations, or an admin manage the install link", () => {
    const rep = profile({ id: "rep-1", role: "staff", workspace_role: "member" });
    assert.equal(canManageInstall(rep, "rep-1"), true);
    assert.equal(canManageInstall(rep, "someone-else"), false);
    assert.equal(canManageInstall(profile({ id: "ops-1", role: "staff", workspace_role: "member", levels: { operations: "edit" } }), "someone-else"), true);
    assert.equal(canManageInstall(profile({ id: "admin-1", role: "admin", workspace_role: "admin" }), null), true);
  });

  it("allows a 200 MB video and refuses a larger one", () => {
    assert.equal(planAccessMediaUpload("video/mp4", ACCESS_VIDEO_MAX_BYTES).ok, true);
    assert.equal(planAccessMediaUpload("video/quicktime", ACCESS_VIDEO_MAX_BYTES + 1).ok, false);
    assert.equal(planAccessMediaUpload("image/jpeg", 1024).ok, true);
    assert.equal(planAccessMediaUpload("image/heic", 1024).ok, true);
    assert.equal(planAccessMediaUpload("image/gif", 1024).ok, false);
    assert.equal(accessMediaBytesMatch("image/jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), true);
    assert.equal(accessMediaBytesMatch("image/jpeg", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), false);
    assert.equal(accessMediaBytesMatch("image/png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
    assert.equal(accessMediaBytesMatch("image/webp", Uint8Array.from([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")])), true);
    assert.equal(accessMediaBytesMatch("image/heic", ftyp("heic")), true);
    assert.equal(accessMediaBytesMatch("video/mp4", ftyp("isom")), true);
    assert.equal(accessMediaBytesMatch("video/quicktime", ftyp("qt  ")), true);
    assert.equal(accessMediaBytesMatch("video/mp4", ftyp("heic")), false);
    const stored = storedAccessMediaOk("ops/install/11111111-1111-1111-1111-111111111111.jpg", "image/jpeg", 1024);
    assert.equal(stored.ok, true);
    assert.equal(storedAccessMediaOk("ops/install/11111111-1111-1111-1111-111111111111.jpg", "video/mp4", 1024).ok, false);
  });

  it("reads a 206 range body without the stream reader", async () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const ranged = new Response(jpeg, { status: 206, headers: { "content-range": "bytes 0-5/6" } });
    const head = await readStoredObjectHead(ranged);
    assert.ok(head);
    assert.equal(accessMediaBytesMatch("image/jpeg", head), true);
    const html = new Response(Buffer.from("<html>not a jpeg</html>"), { status: 206 });
    const posed = await readStoredObjectHead(html);
    assert.ok(posed);
    assert.equal(accessMediaBytesMatch("image/jpeg", posed), false);
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

  it("refuses to send outside production when EMAIL_REDIRECT_TO is unset", async () => {
    const rows: EmailLogRow[] = [];
    let called = false;
    const result = await sendPulseEmail(
      { to: "customer@example.com", subject: "Access", template: "access_form", text: "Link", html: "<p>Link</p>", accessPath: "/access/token" },
      {
        env: { RESEND_API_KEY: "re_test", VERCEL_ENV: "preview" },
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
    assert.equal(rows[0]?.accessPath, "/access/token");
    assert.match(rows[0]?.detail ?? "", /EMAIL_REDIRECT_TO/);
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

function ftyp(brand: string) {
  const bytes = new Uint8Array(16);
  bytes.set(Buffer.from("ftyp"), 4);
  bytes.set(Buffer.from(brand), 8);
  return bytes;
}

function profile(overrides: Partial<Profile>): Profile {
  return {
    id: "profile-1",
    email: "rep@jordanfitness.com",
    full_name: "Rep",
    role: "staff",
    is_active: true,
    access_granted: true,
    last_sign_in_at: null,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    workspace_role: "member",
    ...overrides,
  };
}
