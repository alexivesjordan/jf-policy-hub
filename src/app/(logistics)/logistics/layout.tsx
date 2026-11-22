import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageSkeleton } from "@/components/pulse/states";
import { requireLogisticsApi } from "@/features/logistics/commercial-invoice/access";
import { isFixtureMode, isSupabaseConfigured } from "@/lib/env";
import { pulseModules } from "@/modules/registry";

export const instant = false;

export default function LogisticsLayout({ children }: { children: ReactNode }) {
  if (!isSupabaseConfigured() && !isFixtureMode()) {
    return <main className="mx-auto max-w-xl px-6 py-16"><h1 className="font-display text-4xl">Logistics needs a database connection</h1></main>;
  }
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper p-6"><PageSkeleton /></div>}>
      <LogisticsShell>{children}</LogisticsShell>
    </Suspense>
  );
}

async function LogisticsShell({ children }: { children: ReactNode }) {
  const gate = await requireLogisticsApi();
  if (!gate.profile) redirect("/login");
  if (gate.error) redirect("/no-access");
  const nav = pulseModules.find((module) => module.id === "logistics")?.nav ?? [];
  return (
    <AppShell profile={gate.profile} pending={0} unread={0} isOwner={gate.profile.workspace_role === "owner"} nav={nav} showLogistics>
      {children}
    </AppShell>
  );
}
