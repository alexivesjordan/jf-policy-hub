import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { authConfirmRedirect } from "@/lib/site-url";
import { passwordSetupPath } from "@/lib/auth-link";
import {
  INVITE_NEEDS_KEY,
  INVITE_NOT_SENT,
  INVITE_SENT,
  resendInviteEmail,
} from "@/lib/workspace-invite";

const redirectTo = "https://pulse.jordanfitness.com/auth/confirm?next=%2Faccount%2Fpassword%3Fsetup%3D1";

describe("resend invite email", () => {
  it("does not call the sender when the service role is missing", async () => {
    let calls = 0;
    const result = await resendInviteEmail({
      email: "lewis.beale@jordanfitness.com",
      redirectTo,
      hasServiceRole: false,
      send: async () => {
        calls += 1;
        return { error: null };
      },
    });
    expect(calls).toBe(0);
    expect(result).toMatchObject({ ok: false, message: INVITE_NEEDS_KEY });
  });

  it("does not call the sender when the admin client is missing", async () => {
    const result = await resendInviteEmail({
      email: "lewis.beale@jordanfitness.com",
      redirectTo,
      hasServiceRole: true,
      send: null,
    });
    expect(result).toMatchObject({ ok: false, message: INVITE_NEEDS_KEY });
  });

  it("returns an error when inviteUserByEmail fails and does not claim success", async () => {
    let sent = "";
    const result = await resendInviteEmail({
      email: " lewis.beale@jordanfitness.com ",
      redirectTo,
      hasServiceRole: true,
      send: async (email, options) => {
        sent = `${email} ${options.redirectTo}`;
        return { error: { message: "already registered" } };
      },
    });
    expect(sent).toBe(`lewis.beale@jordanfitness.com ${redirectTo}`);
    expect(result).toMatchObject({ ok: false, message: INVITE_NOT_SENT });
  });

  it("returns an error when the sender throws", async () => {
    const result = await resendInviteEmail({
      email: "lewis.beale@jordanfitness.com",
      redirectTo,
      hasServiceRole: true,
      send: async () => {
        throw new Error("smtp down");
      },
    });
    expect(result).toMatchObject({ ok: false, message: INVITE_NOT_SENT });
  });

  it("reports success only after the stubbed sender accepts the redirect", async () => {
    let redirect = "";
    const result = await resendInviteEmail({
      email: "lewis.beale@jordanfitness.com",
      redirectTo,
      hasServiceRole: true,
      send: async (_email, options) => {
        redirect = options.redirectTo;
        return { error: null };
      },
    });
    expect(redirect).toBe(redirectTo);
    expect(result).toMatchObject({ ok: true, message: INVITE_SENT });
  });
});

describe("resend workspace invite action", () => {
  it("stays admin-only, keeps the confirm redirect, and revalidates both member routes", () => {
    const source = readFileSync(new URL("../features/workspace/actions.ts", import.meta.url), "utf8");
    const fn = source.slice(source.indexOf("export async function resendWorkspaceInvite"));
    expect(fn.indexOf("requireWorkspaceAdmin")).toBeGreaterThan(-1);
    expect(fn.indexOf("requireWorkspaceAdmin")).toBeLessThan(fn.indexOf("resendInviteEmail"));
    expect(fn).toContain("inviteUserByEmail");
    expect(fn).toContain("authConfirmRedirect(passwordSetupPath())");
    expect(fn).toContain('revalidatePath("/settings/workspace/members")');
    expect(fn).toContain('revalidatePath("/settings/workspace/members/[id]", "page")');
    expect(fn.indexOf("if (result?.ok)")).toBeLessThan(fn.indexOf("workspace_log_invite_resent"));
    expect(fn.indexOf("workspace_log_invite_resent")).toBeLessThan(fn.indexOf('revalidatePath("/settings/workspace/members")'));
    expect(fn.indexOf("if (result?.ok)")).toBeLessThan(fn.indexOf('revalidatePath("/settings/workspace/members")'));
    expect(fn).toContain("last_sign_in_at");
    const previous = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://pulse.jordanfitness.com";
    try {
      expect(authConfirmRedirect(passwordSetupPath())).toBe(redirectTo);
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
      else process.env.NEXT_PUBLIC_SITE_URL = previous;
    }
  });
});
