import { Suspense, type ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import type { BellItem } from "@/components/notification-bell";
import { PageSkeleton } from "@/components/pulse/states";
import { fieldRole } from "@/features/field/queries";
import { listPulseNotifications } from "@/features/operations/queries";
import { listMyNotifications } from "@/features/policies/queries";
import { canUseLogistics, canUseService } from "@/lib/access";
import { getCurrentProfile } from "@/lib/auth";
import { isFixtureMode, isSupabaseConfigured } from "@/lib/env";
import { ownerTwoStepNotice } from "@/lib/owner-two-step-notice";
import { ENGINEER_NAV } from "@/lib/shell-nav";
import { destinationForVisitLink, engineerPlannerRedirect, visitAudience } from "@/lib/service/visit-route";
import { pulseModules } from "@/modules/registry";

export const instant = false;

export default function ServiceLayout({ children }: { children: ReactNode }) {
  if (!isSupabaseConfigured() && !isFixtureMode()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
        <h1 className="font-display text-4xl">Service needs a database connection</h1>
      </main>
    );
  }
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper p-6"><PageSkeleton /></div>}>
      <ServiceShell>{children}</ServiceShell>
    </Suspense>
  );
}

async function ServiceShell({ children }: { children: ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/service");
  if (!profile.access_granted) redirect("/no-access");
  if (!profile.is_active) redirect("/account-inactive");
  const path = (await headers()).get("x-pathname") ?? "";
  let role = "none";
  try {
    role = await fieldRole();
  } catch {
    role = "none";
  }
  const engineer = role === "engineer";
  const job = path.startsWith("/service/job");
  const plannerRedirect = engineerPlannerRedirect(role, path);
  if (plannerRedirect) redirect(plannerRedirect);
  const allowed = canUseService(profile) || engineer || path.startsWith("/service/day") || job;
  if (!allowed) redirect("/no-access");
  if (engineer && path.startsWith("/service") && !path.startsWith("/service/day") && !job) redirect("/service/day");
  const audience = visitAudience(role);
  let notifications: BellItem[] = [];
  try {
    const [operations, people] = await Promise.all([
      listPulseNotifications(false).catch(() => []),
      listMyNotifications(),
    ]);
    notifications = [
      ...people.map((item) => ({
        id: item.id,
        source: item.kind === "radar" ? "sales" as const : "people" as const,
        title: item.title,
        body: item.body,
        href: destinationForVisitLink(audience, item.link),
        read: Boolean(item.read_at),
        createdAt: item.created_at,
      })),
      ...operations.map((item) => ({
        id: item.id,
        source: "operations" as const,
        title: item.title,
        body: item.body,
        href: destinationForVisitLink(audience, item.link),
        read: Boolean(item.read_at),
        createdAt: item.created_at,
      })),
    ]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20)
      .map((item) => ({ id: item.id, source: item.source, title: item.title, body: item.body, href: item.href, read: item.read }));
  } catch {
    notifications = [];
  }
  const nav = engineer ? ENGINEER_NAV : (pulseModules.find((module) => module.id === "service")?.nav ?? []);
  return (
    <AppShell
      profile={profile}
      pending={0}
      unread={notifications.filter((item) => !item.read).length}
      isOwner={profile.workspace_role === "owner"}
      nav={nav}
      notifications={notifications}
      showLogistics={canUseLogistics(profile) && !engineer}
      fieldEngineer={engineer}
      ownerNotice={await ownerTwoStepNotice()}
    >
      {children}
    </AppShell>
  );
}
