"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { markPulseNotificationRead } from "@/features/operations/actions";
import { markNotificationRead } from "@/features/notifications/actions";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { EmptyState } from "@/components/pulse/states";

export type BellItem = {
  id: string;
  source: "people" | "operations";
  title: string;
  body: string;
  href: string | null;
  read: boolean;
};

export function NotificationBell({ items }: { items: BellItem[] }) {
  const unread = items.filter((item) => !item.read).length;

  return (
    <Popover>
      <PopoverTrigger
        className="relative inline-flex size-11 items-center justify-center rounded-full border border-line text-sm font-semibold text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <Bell className="size-4" aria-hidden="true" />
        {unread > 0 ? (
          <span className="absolute -top-1 -right-1 inline-flex min-w-5 items-center justify-center rounded-full bg-red px-1.5 text-xs text-white">{unread}</span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(20rem,calc(100vw-1.5rem))]">
        <PopoverHeader>
          <PopoverTitle>Notifications</PopoverTitle>
          <PopoverDescription>{unread > 0 ? `${unread} unread` : "You are up to date."}</PopoverDescription>
        </PopoverHeader>
        {items.length === 0 ? <EmptyState title="No notifications" description="Updates from People and Operations will land here." /> : null}
        <ul className="max-h-96 space-y-1 overflow-auto">
          {items.map((item) => (
            <li key={`${item.source}-${item.id}`} className="rounded-xl px-2 py-2">
              <p className="text-xs uppercase tracking-wide text-grey">{item.source === "people" ? "People" : "Operations"}</p>
              <p className="text-sm font-semibold text-ink">{item.title}</p>
              <p className="mt-1 text-sm text-grey">{item.body}</p>
              <div className="mt-2 flex gap-3 text-sm">
                {item.href ? (
                  <Link href={item.href} className="inline-flex min-h-11 items-center font-semibold text-ink underline decoration-red">
                    Open
                  </Link>
                ) : null}
                {item.read ? null : (
                  <form action={item.source === "people" ? markNotificationRead : markPulseNotificationRead}>
                    <input type="hidden" name="id" value={item.id} />
                    <button type="submit" className="inline-flex min-h-11 items-center font-semibold text-ink underline decoration-red">Mark read</button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
