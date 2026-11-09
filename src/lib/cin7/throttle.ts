/** Sliding window. Cin7 Core allows 60 calls a minute. */
export function createCin7Throttle(options?: {
  limit?: number;
  windowMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}) {
  const limit = options?.limit ?? 60;
  const windowMs = options?.windowMs ?? 60_000;
  const now = options?.now ?? (() => Date.now());
  const sleep = options?.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const stamps: number[] = [];
  let chain: Promise<void> = Promise.resolve();

  async function take() {
    const run = chain.then(async () => {
      for (;;) {
        const time = now();
        while (stamps.length > 0 && time - stamps[0] >= windowMs) stamps.shift();
        if (stamps.length < limit) {
          stamps.push(time);
          return;
        }
        await sleep(stamps[0] + windowMs - time + 5);
      }
    });
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    await run;
  }

  return { take };
}
