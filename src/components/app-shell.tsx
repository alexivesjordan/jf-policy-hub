"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { NotificationBell, type BellItem } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
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
      <aside className="hidden flex-col border-line bg-pine text-ink md:sticky md:top-0 md:flex md:h-screen md:border-r">
        <div className="px-5 py-6">
          <Link href="/" className="block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-grey">Jordan Pulse</p>
            <p className="font-display mt-1 text-xl text-ink">{current?.name ?? "Modules"}</p>
          </Link>
          <p className="mt-1 text-xs text-grey">{current?.tagline}</p>
        </div>
        <SideNav items={items} counts={counts} />
        <div className="mt-auto border-t border-line px-3 py-3">
          <UserMenu profile={profile} placement="up" />
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-paper/95 px-3 py-2 backdrop-blur">
          <MobileNav items={items} counts={counts} title={current?.name ?? "Jordan Pulse"} tagline={current?.tagline ?? ""} />
          <Link href="/" className="mr-auto min-w-0 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden">
            <span className="block truncate text-sm font-semibold">{current?.name ?? "Jordan Pulse"}</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell items={notifications} />
            <ThemeToggle />
            <div className="md:hidden">
              <UserMenu profile={profile} placement="down" className="max-w-[9rem]" />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

function MobileNav({
  items,
  counts,
  title,
  tagline,
}: {
  items: { href: string; label: string; count?: "pending" | "unread"; disabled?: boolean }[];
  counts: { pending: number; unread: number };
  title: string;
  tagline: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="inline-flex size-11 items-center justify-center rounded-full border border-line text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden"
        aria-label="Open menu"
      >
        <Menu className="size-5" aria-hidden="true" />
      </SheetTrigger>
      <SheetContent side="left" className="bg-pine text-ink">
        <SheetHeader>
          <SheetTitle>Jordan Pulse</SheetTitle>
          <SheetDescription>{title}{tagline ? ` · ${tagline}` : ""}</SheetDescription>
        </SheetHeader>
        <SideNav items={items} counts={counts} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

function SideNav({
  items,
  counts,
  onNavigate,
}: {
  items: { href: string; label: string; count?: "pending" | "unread"; disabled?: boolean }[];
  counts: { pending: number; unread: number };
  onNavigate?: () => void;
}) {
  const path = usePathname();

  return (
    <nav className="flex flex-col gap-1 px-3 pb-4" aria-label="Module">
      {items.map((item) => {
        const exact = item.href === "/dashboard" || item.href === "/operations" || item.href === "/sales" || item.href === "/workspace";
        if (item.disabled) {
          return (
            <span key={item.href} className="flex min-h-11 items-center rounded-2xl px-3 text-sm font-semibold text-grey" aria-disabled="true">
              {item.label}
              <span className="ml-2 text-[11px] uppercase tracking-wide">Soon</span>
            </span>
          );
        }
        const active = exact ? path === item.href : path === item.href || path.startsWith(`${item.href}/`);
        const count = item.count ? counts[item.count] : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
            className={cn(
              "flex min-h-11 items-center justify-between gap-3 rounded-2xl px-3 text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active ? "bg-red text-white" : "text-ink hover:bg-ink/5",
            )}
          >
            <span>{item.label}</span>
            {count ? <span className="font-mono text-xs tabular-nums">{count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
