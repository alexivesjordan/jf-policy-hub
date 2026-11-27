import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { CRON_PATHS, proxy } from "@/proxy";
import { GET as radarIngest } from "@/app/api/sales/radar/ingest/route";

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, connection: async () => undefined };
});

vi.mock("@/features/radar/run", () => ({
  runRadarIngest: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Radar ingest must not run without the cron secret.");
  }),
}));

const originalFetch = globalThis.fetch;
const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const originalSecret = process.env.CRON_SECRET;

function cronPaths() {
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
    crons: { path: string }[];
  };
  return vercel.crons.map((cron) => cron.path);
}

function noSession() {
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
}

describe("vercel cron paths stay allowlisted", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it("allowlists every vercel.json cron path so a sessionless call is not sent to login", async () => {
    const paths = cronPaths();
    expect(paths.length).toBeGreaterThan(0);
    expect(CRON_PATHS).toEqual(expect.arrayContaining(paths));

    noSession();
    for (const path of paths) {
      const response = await proxy(new NextRequest(`https://pulse.example${path}`));
      expect(response.status, path).not.toBe(307);
      expect(response.headers.get("location"), path).toBeNull();
    }

    const guarded = await proxy(new NextRequest("https://pulse.example/sales/installs"));
    expect(guarded.headers.get("location") ?? "").toMatch(/\/login/);
  });

  it("does not redirect an unauthenticated radar ingest and returns 401 without the secret", async () => {
    noSession();
    delete process.env.CRON_SECRET;

    const proxied = await proxy(new NextRequest("https://pulse.example/api/sales/radar/ingest"));
    expect(proxied.status).not.toBe(307);
    expect(proxied.headers.get("location")).toBeNull();

    const missing = await radarIngest(new Request("https://pulse.example/api/sales/radar/ingest"));
    expect(missing.status).toBe(401);
    expect(missing.headers.get("location")).toBeNull();
    await expect(missing.json()).resolves.toEqual({ ok: false });

    process.env.CRON_SECRET = "cron-test-secret";
    const unsigned = await radarIngest(new Request("https://pulse.example/api/sales/radar/ingest"));
    expect(unsigned.status).toBe(401);
    await expect(unsigned.json()).resolves.toEqual({ ok: false });
  });
});
