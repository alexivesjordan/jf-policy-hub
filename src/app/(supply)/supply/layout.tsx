import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageSkeleton } from "@/components/pulse/states";
import { canAdminSupply, canUseLogistics, canUseSupply } from "@/lib/access";
import { getCurrentProfile } from "@/lib/auth";
import { isFixtureMode, isSupabaseConfigured } from "@/lib/env";
import { ownerTwoStepNotice } from "@/lib/owner-two-step-notice";
import { pulseModules } from "@/modules/registry";

export const instant = false;

export default function SupplyLayout({ children }: { children: ReactNode }) {
  if (!isSupabaseConfigured() && !isFixtureMode()) {
    return <main className="mx-auto max-w-xl px-6 py-16"><h1 className="font-display text-4xl">Supply needs a database connection</h1></main>;
  }
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper p-6"><PageSkeleton /></div>}>
      <SupplyShell>{children}</SupplyShell>
    </Suspense>
  );
}

async function SupplyShell({ children }: { children: ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/supply");
  if (!profile.access_granted) redirect("/no-access");
  if (!profile.is_active) redirect("/account-inactive");
  if (!canUseSupply(profile)) redirect("/no-access");
  const nav = (pulseModules.find((module) => module.id === "supply")?.nav ?? []).filter((item) => item.href !== "/supply/settings" || canAdminSupply(profile));
  return (
    <AppShell profile={profile} pending={0} unread={0} isOwner={profile.workspace_role === "owner"} nav={nav} showLogistics={canUseLogistics(profile)} ownerNotice={await ownerTwoStepNotice()}>
      {children}
    </AppShell>
  );
}
