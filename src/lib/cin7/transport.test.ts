import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCin7Throttle } from "./throttle";
import { cin7Get, cin7Request, type Cin7Fetch } from "./transport";

const secret = "super-secret-application-key";
const account = "account-id-should-not-leak";

function response(status: number, body: unknown, headers: Record<string, string> = {}): Awaited<ReturnType<Cin7Fetch>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

describe("Cin7 transport", () => {
  it("does not call the network for POST, PUT, DELETE, or an unlisted path", async () => {
    let calls = 0;
    const fetchImpl: Cin7Fetch = async () => {
      calls += 1;
      return response(200, {});
    };
    for (const method of ["POST", "PUT", "DELETE"]) {
      await assert.rejects(
        () => cin7Request({ method, path: "sale", query: { ID: "x" }, accountId: account, applicationKey: secret, fetchImpl }),
        /blocked/,
      );
    }
    await assert.rejects(
      () => cin7Request({ method: "GET", path: "me", accountId: account, applicationKey: secret, fetchImpl }),
      /blocked/,
    );
    assert.equal(calls, 0);
  });

  it("sends the auth headers on an allowlisted GET and hides them from errors", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl: Cin7Fetch = async (url, init) => {
      seen.push({ url, headers: init.headers });
      return response(500, { Exception: `leaked ${secret} ${account}` });
    };
    await assert.rejects(
      () => cin7Get({ accountId: account, applicationKey: secret, path: "sale", query: { ID: "sale-1" }, fetchImpl, throttle: { take: async () => undefined } }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : "";
        assert.match(message, /Cin7 returned 500 for sale/);
        assert.equal(message.includes(secret), false);
        assert.equal(message.includes(account), false);
        return true;
      },
    );
    assert.equal(seen.length, 1);
    assert.equal(seen[0].headers["api-auth-accountid"], account);
    assert.equal(seen[0].headers["api-auth-applicationkey"], secret);
    assert.match(seen[0].url, /\/sale\?ID=sale-1$/);
  });

  it("retries a 429 and then reads the JSON", async () => {
    const waits: number[] = [];
    let calls = 0;
    const fetchImpl: Cin7Fetch = async () => {
      calls += 1;
      if (calls === 1) return response(429, { Exception: "slow down" }, { "retry-after": "0" });
      return response(200, { ID: "sale-1" });
    };
    const body = await cin7Get({
      accountId: account,
      applicationKey: secret,
      path: "sale",
      query: { ID: "sale-1" },
      fetchImpl,
      throttle: { take: async () => undefined },
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    assert.deepEqual(body, { ID: "sale-1" });
    assert.equal(calls, 2);
    assert.deepEqual(waits, [0]);
  });

  it("waits once the minute window is full", async () => {
    let clock = 0;
    const waits: number[] = [];
    const throttle = createCin7Throttle({
      limit: 2,
      windowMs: 1000,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    await throttle.take();
    await throttle.take();
    await throttle.take();
    assert.equal(waits.length, 1);
    assert.ok(waits[0] > 1000);
  });
});
