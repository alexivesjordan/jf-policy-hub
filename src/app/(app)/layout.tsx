import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { pendingCount, unreadCount } from "@/features/policies/queries";

export const instant = false;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-yellow">Jordan Orbit</p>
        <h1 className="font-display mt-2 text-4xl">Jordan Orbit needs a database connection</h1>
        <p className="mt-3 leading-7 text-ink/80">
          Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local, apply the SQL migrations, then restart the app. The README lists every step.
        </p>
      </main>
    );
  }

  return (
    <Suspense fallback={<ShellFallback />}>
      <AuthedShell>{children}</AuthedShell>
    </Suspense>
  );
}

async function AuthedShell({ children }: { children: React.ReactNode }) {
  const profile = await requireUser();
  const [pending, unread] = await Promise.all([pendingCount(), unreadCount(profile.id)]);
  return (
    <AppShell profile={profile} pending={pending} unread={unread}>
      {children}
    </AppShell>
  );
}

function ShellFallback() {
  return (
    <div className="min-h-screen bg-paper md:grid md:grid-cols-[16.5rem_1fr]">
      <div className="min-h-24 bg-pine md:min-h-screen" />
      <p className="px-8 py-10 text-ink/60">Loading Jordan Orbit...</p>
    </div>
  );
}
