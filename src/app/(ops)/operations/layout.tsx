import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import type { BellItem } from "@/components/notification-bell";
import { getOfficeContext, listPulseNotifications } from "@/features/operations/queries";
import { listMyNotifications } from "@/features/policies/queries";
import { cin7IsConnected } from "@/lib/cin7/client";
import { requireOperationsUser } from "@/lib/auth";
import { PageSkeleton } from "@/components/pulse/states";
import { isFixtureMode, isSupabaseConfigured } from "@/lib/env";
import { pulseModules } from "@/modules/registry";

export const instant = false;

export default function OperationsLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured() && !isFixtureMode()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-grey">Jordan Pulse</p>
        <h1 className="font-display mt-2 text-4xl">The install office needs a database connection</h1>
        <p className="mt-3 leading-7 text-ink/80">
          Add the Supabase keys to .env.local, apply the migrations on a preview project, then restart. Fixture jobs are marked FIXTURE and are not from Cin7.
        </p>
      </main>
    );
  }

  return (
    <Suspense fallback={<div className="min-h-screen bg-paper p-6"><PageSkeleton /></div>}>
      <OperationsShell>{children}</OperationsShell>
    </Suspense>
  );
}

async function OperationsShell({ children }: { children: React.ReactNode }) {
  const profile = await requireOperationsUser();
  let isOwner = false;
  let unread = 0;
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
    unread = notifications.filter((item) => !item.read).length;
  } catch {
    isOwner = false;
  }

  const nav = (pulseModules.find((module) => module.id === "operations")?.nav ?? []).filter(
    (item) => !item.ownerOnly || isOwner,
  );

  return (
    <AppShell profile={profile} pending={0} unread={unread} isOwner={isOwner} nav={nav} notifications={notifications}>
      {isOwner && !cin7IsConnected() ? (
        <p className="mb-6 rounded-2xl border border-line bg-card px-4 py-3 text-sm text-ink">Live orders are not connected yet.</p>
      ) : null}
      {children}
    </AppShell>
  );
}
