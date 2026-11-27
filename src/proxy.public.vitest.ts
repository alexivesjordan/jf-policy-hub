import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

describe("order tracker routes stay public", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  });

  it("does not send the customer page or its photos to login", async () => {
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

    const track = await proxy(new NextRequest("https://pulse.example/track/example-token"));
    const media = await proxy(new NextRequest("https://pulse.example/api/track/media/example-token/photo"));
    const sales = await proxy(new NextRequest("https://pulse.example/sales/orders"));

    expect(track.headers.get("location")).toBeNull();
    expect(media.headers.get("location")).toBeNull();
    expect(sales.headers.get("location") ?? "").toMatch(/\/login/);
  });
});
