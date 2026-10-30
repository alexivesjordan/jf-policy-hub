"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { signOut } from "@/features/auth/actions";
import { roleLabel } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { moduleFromPath } from "@/modules/registry";
import { cn } from "@/lib/utils";

export function AppShell({
  profile,
  pending,
  unread,
  children,
}: {
  profile: Profile;
  pending: number;
  unread: number;
  children: ReactNode;
}) {
  const path = usePathname();
  const current = moduleFromPath(path);
  const counts = { pending, unread };
  const items = (current?.nav ?? []).filter((item) => !item.adminOnly || profile.role === "admin");

  return (
    <div className="min-h-screen bg-paper text-ink md:grid md:grid-cols-[16.5rem_1fr]">
      <aside className="border-line bg-pine text-white md:min-h-screen md:border-r">
        <div className="px-4 py-4 md:px-5 md:py-6">
          <Link href="/" className="block rounded-xl outline-none">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-grey">Jordan Orbit</p>
            <p className="font-display mt-1 text-xl text-white">{current?.name ?? "Modules"}</p>
          </Link>
          <p className="mt-1 text-xs text-grey">{current?.tagline}</p>
        </div>
        <SideNav items={items} counts={counts} />
        <div className="hidden border-t border-white/10 px-5 py-4 md:block">
          <p className="truncate text-sm font-semibold">{profile.full_name || profile.email}</p>
          <p className="text-sm text-grey">{roleLabel(profile.role)}</p>
          <form action={signOut} className="mt-3">
            <button type="submit" className="text-sm font-semibold text-white underline decoration-red underline-offset-4">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <div className="min-w-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-3 md:hidden">
          <p className="truncate text-sm">{profile.full_name || profile.email}</p>
          <form action={signOut}>
            <button type="submit" className="text-sm font-semibold text-white underline decoration-red underline-offset-4">
              Sign out
            </button>
          </form>
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
    <nav className="flex gap-1 overflow-x-auto px-3 pb-4 md:flex-col md:px-3" aria-label="Orbit People">
      {items.map((item) => {
        const active = item.href === "/dashboard" ? path === item.href : path === item.href || path.startsWith(`${item.href}/`);
        const count = item.count ? counts[item.count] : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex min-h-11 shrink-0 items-center justify-between gap-3 rounded-2xl px-3 text-sm font-semibold",
              active ? "bg-red text-white" : "text-white hover:bg-white/10",
            )}
          >
            <span>{item.label}</span>
            {count ? (
              <span className="font-mono text-xs tabular-nums text-white">{count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
