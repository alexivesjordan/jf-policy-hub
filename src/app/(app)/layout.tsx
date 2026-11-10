import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import type { BellItem } from "@/components/notification-bell";
import { listPulseNotifications } from "@/features/operations/queries";
import { requireUser } from "@/lib/auth";
import { PageSkeleton } from "@/components/pulse/states";
import { isFixtureMode, isSupabaseConfigured } from "@/lib/env";
import { listMyNotifications, pendingCount, unreadCount } from "@/features/policies/queries";

export const instant = false;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured() && !isFixtureMode()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-grey">Jordan Pulse</p>
        <h1 className="font-display mt-2 text-4xl">Jordan Pulse needs a database connection</h1>
        <p className="mt-3 leading-7 text-ink/80">
          Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local, apply the SQL migrations, then restart the app. The README lists every step.
        </p>
      </main>
    );
  }

  return (
    <Suspense fallback={<div className="min-h-screen bg-paper p-6"><PageSkeleton /></div>}>
      <AuthedShell>{children}</AuthedShell>
    </Suspense>
  );
}

async function AuthedShell({ children }: { children: React.ReactNode }) {
  const profile = await requireUser();
  const [pending, unread, people, operations] = await Promise.all([
    pendingCount(),
    unreadCount(profile.id),
    listMyNotifications(),
    listPulseNotifications(false).catch(() => []),
  ]);
  const notifications: BellItem[] = [
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
  return (
    <AppShell profile={profile} pending={pending} unread={unread} notifications={notifications}>
      {children}
    </AppShell>
  );
}
