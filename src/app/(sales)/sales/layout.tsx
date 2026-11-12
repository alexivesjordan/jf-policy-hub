import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import type { BellItem } from "@/components/notification-bell";
import { getOfficeContext, listPulseNotifications } from "@/features/operations/queries";
import { listMyNotifications } from "@/features/policies/queries";
import { requireSalesUser } from "@/lib/auth";
import { PageSkeleton } from "@/components/pulse/states";
import { isFixtureMode, isSupabaseConfigured } from "@/lib/env";
import { connection } from "next/server";
import { pulseModules } from "@/modules/registry";

export const instant = false;

export default function SalesLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured() && !isFixtureMode()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-grey">Jordan Pulse</p>
        <h1 className="font-display mt-2 text-4xl">Sales needs a database connection</h1>
      </main>
    );
  }
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper p-6"><PageSkeleton /></div>}>
      <SalesShell>{children}</SalesShell>
    </Suspense>
  );
}

async function SalesShell({ children }: { children: React.ReactNode }) {
  await connection();
  const profile = await requireSalesUser();
  let isOwner = false;
  let notifications: BellItem[] = [];
  try {
    const [context, operations, people] = await Promise.all([
      getOfficeContext(),
      listPulseNotifications(false),
      listMyNotifications(),
    ]);
    isOwner = context.is_owner;
    notifications = [
      ...people.map((item) => ({
        id: item.id,
        source: "people" as const,
        title: item.title,
        body: item.body,
        href: item.link,
        read: Boolean(item.read_at),
        createdAt: item.created_at,
      })),
      ...operations.map((item) => ({
        id: item.id,
        source: "operations" as const,
        title: item.title,
        body: item.body,
        href: item.link,
        read: Boolean(item.read_at),
        createdAt: item.created_at,
      })),
    ]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20)
      .map(({ createdAt: _createdAt, ...item }) => item);
  } catch {
    isOwner = false;
  }
  const nav = (pulseModules.find((module) => module.id === "sales")?.nav ?? []).filter((item) => !item.ownerOnly || isOwner);
  return (
    <AppShell profile={profile} pending={0} unread={notifications.filter((item) => !item.read).length} isOwner={isOwner} nav={nav} notifications={notifications}>
      {children}
    </AppShell>
  );
}
