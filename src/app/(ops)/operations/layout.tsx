import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { getOfficeContext, listOrbitNotifications } from "@/features/operations/queries";
import { requireOperationsUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { orbitModules } from "@/modules/registry";

export const instant = false;

export default function OperationsLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-grey">Jordan Orbit</p>
        <h1 className="font-display mt-2 text-4xl">The install office needs a database connection</h1>
        <p className="mt-3 leading-7 text-ink/80">
          Add the Supabase keys to .env.local, apply the migrations on a preview project, then restart. Fixture jobs are marked FIXTURE and are not from Cin7.
        </p>
      </main>
    );
  }

  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <OperationsShell>{children}</OperationsShell>
    </Suspense>
  );
}

async function OperationsShell({ children }: { children: React.ReactNode }) {
  const profile = await requireOperationsUser();
  let isOwner = false;
  let unread = 0;
  try {
    const [context, notifications] = await Promise.all([
      getOfficeContext(),
      listOrbitNotifications(false),
    ]);
    isOwner = context.is_owner;
    unread = notifications.filter((item) => !item.read_at).length;
  } catch {
    isOwner = false;
  }

  const nav = (orbitModules.find((module) => module.id === "operations")?.nav ?? []).filter(
    (item) => !item.ownerOnly || isOwner,
  );

  return (
    <AppShell profile={profile} pending={0} unread={unread} isOwner={isOwner} nav={nav}>
      {children}
    </AppShell>
  );
}
