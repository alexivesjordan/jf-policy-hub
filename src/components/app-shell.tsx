"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { NotificationBell, type BellItem } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import type { Profile } from "@/lib/types";
import { moduleFromPath, type ModuleNavItem } from "@/modules/registry";
import { cn } from "@/lib/utils";

export function AppShell({
  profile,
  pending,
  unread,
  isOwner = false,
  nav,
  notifications = [],
  children,
}: {
  profile: Profile;
  pending: number;
  unread: number;
  isOwner?: boolean;
  nav?: ModuleNavItem[];
  notifications?: BellItem[];
  children: ReactNode;
}) {
  const path = usePathname();
  const current = moduleFromPath(path);
  const counts = { pending, unread };
  const items = (nav ?? current?.nav ?? []).filter((item) => {
    if (item.adminOnly && profile.role !== "admin") return false;
    if (item.ownerOnly && !isOwner) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-paper text-ink md:grid md:grid-cols-[16.5rem_1fr]">
      <aside className="flex flex-col border-line bg-pine text-ink md:sticky md:top-0 md:h-screen md:border-r">
        <div className="px-4 py-4 md:px-5 md:py-6">
          <Link href="/" className="block rounded-xl outline-none">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-grey">Jordan Pulse</p>
            <p className="font-display mt-1 text-xl text-ink">{current?.name ?? "Modules"}</p>
          </Link>
          <p className="mt-1 text-xs text-grey">{current?.tagline}</p>
        </div>
        <SideNav items={items} counts={counts} />
        <div className="mt-auto hidden border-t border-line px-3 py-3 md:block">
          <UserMenu profile={profile} placement="up" />
        </div>
      </aside>
      <div className="min-w-0">
        <div className="flex items-center justify-end gap-2 border-b border-line px-3 py-2">
          <NotificationBell items={notifications} />
          <ThemeToggle />
          <div className="md:hidden">
            <UserMenu profile={profile} placement="down" className="max-w-xs" />
          </div>
        </div>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

function SideNav({
  items,
  counts,
}: {
  items: { href: string; label: string; count?: "pending" | "unread" }[];
  counts: { pending: number; unread: number };
}) {
  const path = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-4 md:flex-col md:px-3" aria-label="Module">
      {items.map((item) => {
        const exact = item.href === "/dashboard" || item.href === "/operations";
        const active = exact ? path === item.href : path === item.href || path.startsWith(`${item.href}/`);
        const count = item.count ? counts[item.count] : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex min-h-11 shrink-0 items-center justify-between gap-3 rounded-2xl px-3 text-sm font-semibold",
              active ? "bg-red text-white" : "text-ink hover:bg-ink/5",
            )}
          >
            <span>{item.label}</span>
            {count ? (
              <span className="font-mono text-xs tabular-nums">{count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
