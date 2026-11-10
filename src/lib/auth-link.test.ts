import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { confirmDestination, passwordLinkHandoff, passwordSetupPath, readAuthArrival } from "./auth-link";

describe("auth confirm destination", () => {
  it("sends invite and recovery to set-password", () => {
    assert.equal(confirmDestination("invite", "/"), passwordSetupPath());
    assert.equal(confirmDestination("recovery", "https://evil.example"), passwordSetupPath());
  });

  it("sends magic link, signup, and email change to a safe next path", () => {
    assert.equal(confirmDestination("magiclink", "/operations"), "/operations");
    assert.equal(confirmDestination("signup", null), "/");
    assert.equal(confirmDestination("email_change", "//evil"), "/");
  });

  it("recognises a token_hash link", () => {
    const arrival = readAuthArrival(
      "https://pulse.jordanfitness.com/auth/confirm?token_hash=hashed-token&type=recovery&next=%2Faccount%2Fpassword%3Fsetup%3D1",
    );
    assert.equal(arrival.kind, "otp");
    if (arrival.kind === "otp") {
      assert.equal(arrival.otpType, "recovery");
      assert.equal(arrival.tokenHash, "hashed-token");
    }
  });
});

describe("password link handoff", () => {
  it("moves a setup link to confirm so the session can be verified first", () => {
    const handoff = passwordLinkHandoff("/account/password", new URLSearchParams("setup=1"));
    assert.equal(handoff, "/auth/confirm?next=%2Faccount%2Fpassword%3Fsetup%3D1");
  });

  it("keeps a token_hash or pkce code on the confirm route", () => {
    assert.equal(
      passwordLinkHandoff("/account/password", new URLSearchParams("token_hash=abc&type=invite&setup=1")),
      "/auth/confirm?token_hash=abc&type=invite&setup=1&next=%2Faccount%2Fpassword%3Fsetup%3D1",
    );
    assert.equal(
      passwordLinkHandoff("/account/password", new URLSearchParams("code=pkce-code")),
      "/auth/confirm?code=pkce-code&next=%2Faccount%2Fpassword%3Fsetup%3D1",
    );
  });

  it("leaves an ordinary password visit on the page", () => {
    assert.equal(passwordLinkHandoff("/account/password", new URLSearchParams()), null);
    assert.equal(passwordLinkHandoff("/login", new URLSearchParams("setup=1")), null);
  });
});
