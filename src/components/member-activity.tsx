"use client";

import { useState, useTransition } from "react";
import { formatMemberTimestamp } from "@/lib/format";
import { activityLabel, type MemberActivityEvent } from "@/lib/member-activity";

export function MemberActivity({
  events,
  hasMore,
  loadEarlier,
}: {
  events: MemberActivityEvent[];
  hasMore: boolean;
  loadEarlier: (before: string) => Promise<{ events: MemberActivityEvent[]; hasMore: boolean }>;
}) {
  const [rows, setRows] = useState(events);
  const [more, setMore] = useState(hasMore);
  const [cursor, setCursor] = useState(events[events.length - 1]?.at ?? null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (rows.length === 0) return <p className="text-sm text-grey">No activity yet</p>;

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {rows.map((event) => (
          <li key={event.id} className="text-sm">
            <time dateTime={event.at} className="text-grey">{formatMemberTimestamp(event.at)}</time>
            {" "}
            <span className="font-semibold">{event.actor_name?.trim() || "System"}</span>
            {" "}
            {activityLabel(event.action)}
          </li>
        ))}
      </ul>
      {more && cursor ? (
        <button
          type="button"
          className="text-sm font-semibold"
          disabled={pending}
          aria-busy={pending}
          onClick={() => {
            startTransition(async () => {
              try {
                const next = await loadEarlier(cursor);
                setRows((current) => {
                  const seen = new Set(current.map((row) => row.id));
                  return [...current, ...next.events.filter((row) => !seen.has(row.id))];
                });
                setCursor(next.events[next.events.length - 1]?.at ?? cursor);
                setMore(next.hasMore && next.events.length > 0);
                setProblem(null);
              } catch {
                setProblem("Could not load earlier activity.");
              }
            });
          }}
        >
          Load earlier
        </button>
      ) : null}
      {problem ? <p className="text-sm text-grey">{problem}</p> : null}
    </div>
  );
}
