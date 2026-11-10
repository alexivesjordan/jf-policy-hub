"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ChevronsUpDown, Menu } from "lucide-react";
import { NotificationBell, type BellItem } from "@/components/notification-bell";
import { ModuleGlyph } from "@/components/module-icon";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { canManageWorkspace, moduleAllows } from "@/lib/access";
import type { Profile } from "@/lib/types";
import { moduleFromPath, pulseModules, type ModuleNavItem, type PulseModule } from "@/modules/registry";
import { cn } from "@/lib/utils";

function pulseLabel(module: PulseModule) {
  return module.name.replace(/^Pulse /, "");
}

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
  const inWorkspace = path.startsWith("/workspace");
  const current = moduleFromPath(path);
  const heading = inWorkspace ? "Workspace" : current ? pulseLabel(current) : "Jordan Pulse";
  const counts = { pending, unread };
  const items = (nav ?? current?.nav ?? []).filter((item) => {
    if (item.adminOnly && !moduleAllows(profile, "people", "edit")) return false;
    if (item.ownerOnly && !isOwner) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-paper text-ink md:grid md:grid-cols-[16.5rem_1fr]">
      <aside className="hidden flex-col border-line bg-pine text-ink md:sticky md:top-0 md:flex md:h-screen md:border-r">
        <div className="px-3 py-4">
          <PulseSwitcher profile={profile} heading={heading} currentId={inWorkspace ? "workspace" : current?.id} />
        </div>
        <SideNav items={items} counts={counts} />
        <div className="mt-auto border-t border-line px-3 py-3">
          <UserMenu profile={profile} placement="up" />
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-paper/95 px-3 py-2 backdrop-blur">
          <MobileNav
            items={items}
            counts={counts}
            title={heading}
            profile={profile}
            currentId={inWorkspace ? "workspace" : current?.id}
          />
          <p className="mr-auto text-sm font-semibold md:hidden">{heading}</p>
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell items={notifications} />
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

function PulseSwitcher({
  profile,
  heading,
  currentId,
}: {
  profile: Profile;
  heading: string;
  currentId?: string;
}) {
  const choices = pulseModules.filter((module) => {
    const level = profile.levels?.[module.id as keyof NonNullable<Profile["levels"]>];
    if (level === "none") return false;
    return true;
  });
  return (
    <Popover>
      <PopoverTrigger className="flex w-full items-center justify-between gap-2 rounded-xl px-2 py-2 text-left outline-none hover:bg-ink/5 focus-visible:ring-3 focus-visible:ring-ring/50">
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-grey">Jordan Pulse</span>
          <span className="font-display mt-1 block truncate text-xl text-ink">{heading}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-grey" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Switch Pulse</p>
        <ul>
          {choices.map((module) => {
            const soon = module.status === "coming-soon";
            const active = module.id === currentId;
            const body = (
              <>
                <ModuleGlyph name={module.icon} className="size-4" />
                <span className="min-w-0 flex-1 truncate">{pulseLabel(module)}</span>
                {soon ? <span className="text-[11px] uppercase tracking-wide text-grey">Soon</span> : null}
              </>
            );
            return (
              <li key={module.id}>
                {soon ? (
                  <span className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-grey">{body}</span>
                ) : (
                  <Link
                    href={module.href}
                    className={cn(
                      "flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      active ? "bg-red text-white" : "text-ink hover:bg-muted",
                    )}
                  >
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
          {canManageWorkspace(profile) ? (
            <li>
              <Link
                href="/workspace"
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  currentId === "workspace" ? "bg-red text-white" : "text-ink hover:bg-muted",
                )}
              >
                <span className="size-4" aria-hidden="true" />
                Workspace
              </Link>
            </li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function MobileNav({
  items,
  counts,
  title,
  profile,
  currentId,
}: {
  items: { href: string; label: string; count?: "pending" | "unread"; disabled?: boolean }[];
  counts: { pending: number; unread: number };
  title: string;
  profile: Profile;
  currentId?: string;
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
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">{title}</SheetDescription>
          <PulseSwitcher profile={profile} heading={title} currentId={currentId} />
        </SheetHeader>
        <SideNav items={items} counts={counts} onNavigate={() => setOpen(false)} />
        <SheetFooter>
          <UserMenu profile={profile} />
        </SheetFooter>
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
