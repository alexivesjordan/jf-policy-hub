import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { confirmGetPlan, continueToPulsePage } from "./auth-confirm";

const TYPES = ["invite", "recovery", "magiclink", "signup", "email_change"] as const;

describe("auth confirm GET", () => {
  it("does not verify a token_hash link for any mail type", () => {
    for (const type of TYPES) {
      const plan = confirmGetPlan(new URLSearchParams({ token_hash: `token-${type}`, type, next: "/account/password?setup=1" }));
      assert.equal(typeof plan, "object");
      if (typeof plan === "string") continue;
      assert.equal(plan.tokenHash, `token-${type}`);
      assert.equal(plan.otpType, type);
      assert.equal(plan.next, "/account/password?setup=1");
      const page = continueToPulsePage(plan);
      assert.match(page, /<title>Continue to Jordan Pulse<\/title>/);
      assert.match(page, /<h1>Continue to Jordan Pulse<\/h1>/);
      assert.match(page, /<button type="submit">Continue<\/button>/);
      assert.match(page, /method="post"/);
      assert.match(page, new RegExp(`name="token_hash" value="token-${type}"`));
      assert.match(page, new RegExp(`name="type" value="${type}"`));
      assert.equal(page.includes("verifyOtp"), false);
      assert.equal(page.includes("That link is invalid"), false);
    }
  });

  it("keeps the route GET from calling verifyOtp or exchanging a code", () => {
    const source = readFileSync(new URL("../app/auth/confirm/route.ts", import.meta.url), "utf8");
    const getStart = source.indexOf("export async function GET");
    const postStart = source.indexOf("export async function POST");
    const getSource = source.slice(getStart, postStart);
    assert.equal(getSource.includes("verifyOtp"), false);
    assert.equal(getSource.includes("exchangeCodeForSession"), false);
    assert.equal(getSource.includes("setSession"), false);
    assert.match(source.slice(postStart), /verifyOtp/);
  });
});
