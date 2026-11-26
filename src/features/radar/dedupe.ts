export function noticeKey(notice: { source: string; noticeId: string }) {
  return `${notice.source}:${notice.noticeId}`;
}

/** One row per source and notice id. A later publication replaces an earlier copy in the same batch. */
export function dedupeNotices<T extends { source: string; noticeId: string; publishedAt: string | null }>(items: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    if (!item.noticeId || !item.source) continue;
    const key = noticeKey(item);
    const previous = byKey.get(key);
    if (!previous || (item.publishedAt ?? "") >= (previous.publishedAt ?? "")) byKey.set(key, item);
  }
  return [...byKey.values()];
}
