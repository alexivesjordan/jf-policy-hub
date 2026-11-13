import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

describe("customer upload routes stay public", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  });

  it("does not send sign or register to login when Supabase env is set", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test-key";
    globalThis.fetch = async (input) => {
      const href = String(input instanceof Request ? input.url : input);
      if (href.includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ message: "no session" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    };

    const sign = await proxy(new NextRequest("https://pulse.example/api/access/media/sign", { method: "POST" }));
    const register = await proxy(new NextRequest("https://pulse.example/api/access/media/register", { method: "POST" }));
    const sales = await proxy(new NextRequest("https://pulse.example/sales/installs"));

    assert.equal(sign.headers.get("location"), null);
    assert.equal(register.headers.get("location"), null);
    assert.match(sales.headers.get("location") ?? "", /\/login/);
  });
});
