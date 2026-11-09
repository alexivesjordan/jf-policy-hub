"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { markPulseNotificationRead } from "@/features/operations/actions";
import { markNotificationRead } from "@/features/notifications/actions";

export type BellItem = {
  id: string;
  source: "people" | "operations";
  title: string;
  body: string;
  href: string | null;
  read: boolean;
};

export function NotificationBell({ items }: { items: BellItem[] }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const unread = items.filter((item) => !item.read).length;

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-line px-3 text-sm font-semibold text-ink"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        Notifications
        {unread > 0 ? (
          <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-red px-1.5 text-xs text-white">{unread}</span>
        ) : null}
      </button>
      {open ? (
        <div id={menuId} role="menu" className="absolute right-0 z-30 mt-2 w-80 rounded-2xl border border-line bg-card p-2 shadow-[0_16px_40px_rgba(0,0,0,0.12)]">
          {items.length === 0 ? <p className="px-3 py-4 text-sm text-grey">No notifications.</p> : null}
          <ul className="max-h-96 space-y-1 overflow-auto">
            {items.map((item) => (
              <li key={`${item.source}-${item.id}`} className="rounded-xl px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-grey">{item.source === "people" ? "People" : "Operations"}</p>
                <p className="text-sm font-semibold text-ink">{item.title}</p>
                <p className="mt-1 text-sm text-grey">{item.body}</p>
                <div className="mt-2 flex gap-3 text-sm">
                  {item.href ? (
                    <Link href={item.href} className="font-semibold text-ink underline decoration-red" onClick={() => setOpen(false)}>
                      Open
                    </Link>
                  ) : null}
                  {item.read ? null : (
                    <form action={item.source === "people" ? markNotificationRead : markPulseNotificationRead}>
                      <input type="hidden" name="id" value={item.id} />
                      <button type="submit" className="font-semibold text-ink underline decoration-red">Mark read</button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
