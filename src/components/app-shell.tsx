"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { signOut } from "@/features/auth/actions";
import { roleLabel } from "@/lib/format";
import type { Profile } from "@/lib/types";
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
  const items = [
    { href: "/dashboard", label: "Home" },
    { href: "/policies", label: "Policies" },
    { href: "/amendments", label: "Suggestions", count: pending },
    { href: "/notifications", label: "Notifications", count: unread },
  ];

  if (profile.role === "admin") {
    items.push({ href: "/admin/people", label: "People" }, { href: "/admin/categories", label: "Categories" });
  }

  return (
    <div className="min-h-screen bg-paper text-ink md:grid md:grid-cols-[16.5rem_1fr]">
      <aside className="bg-pine text-white md:min-h-screen">
        <div className="flex items-end justify-between gap-4 px-4 py-4 md:block md:px-5 md:py-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Jordan Fitness</p>
            <p className="font-display text-2xl leading-none">Policy Hub</p>
          </div>
        </div>
        <SideNav items={items} />
        <div className="hidden border-t border-white/10 px-5 py-4 md:block">
          <p className="truncate text-sm font-semibold">{profile.full_name || profile.email}</p>
          <p className="text-sm text-white/70">{roleLabel(profile.role)}</p>
          <form action={signOut} className="mt-3">
            <button type="submit" className="text-sm font-semibold text-white underline-offset-2 hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <div className="min-w-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-3 md:hidden">
          <p className="truncate text-sm">{profile.full_name || profile.email}</p>
          <form action={signOut}>
            <button type="submit" className="text-sm font-semibold text-pine">
              Sign out
            </button>
          </form>
        </div>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

function SideNav({ items }: { items: { href: string; label: string; count?: number }[] }) {
  const path = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-4 md:flex-col md:px-3" aria-label="Main">
      {items.map((item) => {
        const active = item.href === "/dashboard" ? path === item.href : path === item.href || path.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex min-h-11 shrink-0 items-center justify-between gap-3 rounded-2xl px-3 text-sm font-semibold",
              active ? "bg-white text-pine" : "text-white/90 hover:bg-white/10",
            )}
          >
            <span>{item.label}</span>
            {item.count ? (
              <span className={cn("rounded-full px-2 py-0.5 text-xs", active ? "bg-clay text-white" : "bg-white/15")}>
                {item.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
