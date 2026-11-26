import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { PageSkeleton } from "@/components/pulse/states";
import { fieldRole } from "@/features/field/queries";
import { canUseLogistics } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { isFixtureMode, isSupabaseConfigured } from "@/lib/env";
import { ownerTwoStepNotice } from "@/lib/owner-two-step-notice";

export const instant = false;

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured() && !isFixtureMode()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-grey">Jordan Pulse</p>
        <h1 className="font-display mt-2 text-4xl">Settings needs a database connection</h1>
      </main>
    );
  }
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper p-6"><PageSkeleton /></div>}>
      <SettingsShell>{children}</SettingsShell>
    </Suspense>
  );
}

async function SettingsShell({ children }: { children: React.ReactNode }) {
  const profile = await requireUser();
  let engineer = false;
  try {
    engineer = (await fieldRole()) === "engineer";
  } catch {
    engineer = false;
  }
  return (
    <AppShell profile={profile} pending={0} unread={0} isOwner={profile.workspace_role === "owner"} showLogistics={canUseLogistics(profile) && !engineer} fieldEngineer={engineer} ownerNotice={await ownerTwoStepNotice()}>
      {children}
    </AppShell>
  );
}
