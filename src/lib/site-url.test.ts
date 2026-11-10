import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authConfirmRedirect, resolveSiteUrl } from "./site-url";

describe("site url", () => {
  it("uses NEXT_PUBLIC_SITE_URL and drops a trailing slash", () => {
    assert.equal(
      resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://pulse.jordanfitness.com/" }),
      "https://pulse.jordanfitness.com",
    );
  });

  it("falls back to the Vercel host", () => {
    assert.equal(
      resolveSiteUrl({ VERCEL_URL: "jf-policy-hub-git-preview.vercel.app" }),
      "https://jf-policy-hub-git-preview.vercel.app",
    );
    assert.equal(
      resolveSiteUrl({ VERCEL_URL: "https://jf-policy-hub.vercel.app/" }),
      "https://jf-policy-hub.vercel.app",
    );
  });

  it("prefers the configured site over the Vercel host", () => {
    assert.equal(
      resolveSiteUrl({
        NEXT_PUBLIC_SITE_URL: "https://pulse.jordanfitness.com",
        VERCEL_URL: "jf-policy-hub.vercel.app",
      }),
      "https://pulse.jordanfitness.com",
    );
  });

  it("uses localhost when neither value is set", () => {
    assert.equal(resolveSiteUrl({}), "http://localhost:3000");
  });

  it("points auth emails at /auth/confirm on that origin", () => {
    const previous = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://pulse.jordanfitness.com";
    try {
      assert.equal(authConfirmRedirect(), "https://pulse.jordanfitness.com/auth/confirm");
      assert.equal(
        authConfirmRedirect("/account/password?setup=1"),
        "https://pulse.jordanfitness.com/auth/confirm?next=%2Faccount%2Fpassword%3Fsetup%3D1",
      );
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
      else process.env.NEXT_PUBLIC_SITE_URL = previous;
    }
  });
});
