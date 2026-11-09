import { CIN7_BASE_URL, assertCin7Get } from "@/lib/cin7/allowlist";
import { createCin7Throttle } from "@/lib/cin7/throttle";

export type Cin7Fetch = (input: string, init: { method: "GET"; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

const sharedThrottle = createCin7Throttle();

function statusMessage(status: number, path: string) {
  if (status === 401 || status === 403) return "Cin7 rejected the API credentials.";
  if (status === 404) return `Cin7 has no ${path} for that id.`;
  if (status === 429) return "Cin7 rate limit. Try again in a minute.";
  return `Cin7 returned ${status} for ${path}.`;
}

/**
 * GET an allowlisted Cin7 path. The allowlist runs before fetch.
 * Credentials are sent as headers and are never included in errors.
 */
export async function cin7Get(options: {
  accountId: string;
  applicationKey: string;
  path: string;
  query?: Record<string, string>;
  fetchImpl?: Cin7Fetch;
  throttle?: { take(): Promise<void> };
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
}): Promise<unknown> {
  const checked = assertCin7Get("GET", options.path, options.query ?? {});
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as Cin7Fetch);
  const throttle = options.throttle ?? sharedThrottle;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const url = new URL(`${options.baseUrl ?? CIN7_BASE_URL}/${checked.path}`);
  for (const [key, value] of Object.entries(checked.query)) url.searchParams.set(key, value);

  const headers = {
    "api-auth-accountid": options.accountId,
    "api-auth-applicationkey": options.applicationKey,
    accept: "application/json",
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await throttle.take();
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      headers,
      signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(20_000) : undefined,
    });
    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter >= 0 ? Math.min(retryAfter * 1000, 60_000) : 1000 * 2 ** attempt;
      await sleep(wait);
      continue;
    }
    if (!response.ok) throw new Error(statusMessage(response.status, checked.path));
    try {
      return await response.json();
    } catch {
      throw new Error(`Cin7 returned an unreadable response for ${checked.path}.`);
    }
  }
  throw new Error(statusMessage(429, checked.path));
}

/** Used by tests that must prove a blocked method never reaches fetch. */
export async function cin7Request(options: {
  method: string;
  path: string;
  query?: Record<string, string>;
  accountId: string;
  applicationKey: string;
  fetchImpl: Cin7Fetch;
}) {
  assertCin7Get(options.method, options.path, options.query ?? {});
  return cin7Get(options);
}
