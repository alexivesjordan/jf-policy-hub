export type CacheRow = { body: unknown; fetchedAt: string; expiresAt: string };

export type CacheStore = {
  get(key: string): Promise<CacheRow | null>;
  set(key: string, body: unknown, fetchedAt: string, expiresAt: string): Promise<void>;
};

const memory = new Map<string, CacheRow>();

export function memoryCache(): CacheStore {
  return {
    async get(key) {
      return memory.get(key) ?? null;
    },
    async set(key, body, fetchedAt, expiresAt) {
      memory.set(key, { body, fetchedAt, expiresAt });
    },
  };
}

export function clearMemoryCache() {
  memory.clear();
}

/**
 * Fresh cache is used first. A failed load falls back to the last saved copy.
 * The fallback is marked stale. Nothing is invented when there is no copy.
 */
export async function cached<T>(key: string, ttlMs: number, store: CacheStore | null, load: () => Promise<T>, now = Date.now()): Promise<{ value: T; stale: boolean; fetchedAt: string }> {
  const fresh = await readFresh(key, store, now);
  if (fresh) return { value: fresh.body as T, stale: false, fetchedAt: fresh.fetchedAt };
  try {
    const value = await load();
    const fetchedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + ttlMs).toISOString();
    memory.set(key, { body: value, fetchedAt, expiresAt });
    await store?.set(key, value, fetchedAt, expiresAt);
    return { value, stale: false, fetchedAt };
  } catch (error) {
    const saved = memory.get(key) ?? (store ? await store.get(key) : null);
    if (saved) return { value: saved.body as T, stale: true, fetchedAt: saved.fetchedAt };
    throw error;
  }
}

async function readFresh(key: string, store: CacheStore | null, now: number) {
  const local = memory.get(key);
  if (local && Date.parse(local.expiresAt) > now) return local;
  const saved = store ? await store.get(key) : null;
  if (saved && Date.parse(saved.expiresAt) > now) {
    memory.set(key, saved);
    return saved;
  }
  return null;
}
