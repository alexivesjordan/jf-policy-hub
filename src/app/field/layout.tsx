import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import type { BellItem } from "@/components/notification-bell";
import { fieldRole } from "@/features/field/queries";
import { getOfficeContext, listPulseNotifications } from "@/features/operations/queries";
import { listMyNotifications } from "@/features/policies/queries";
import { canUseOperations, canUseSales } from "@/lib/access";
import { getCurrentProfile } from "@/lib/auth";
import { isFixtureMode, isSupabaseConfigured } from "@/lib/env";
import { ownerTwoStepNotice } from "@/lib/owner-two-step-notice";
import { ENGINEER_NAV, visibleNav } from "@/lib/shell-nav";
import { destinationForVisitLink, visitAudience } from "@/lib/service/visit-route";
import { pulseModules } from "@/modules/registry";

export const instant = false;

export default function FieldLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={children}>
      <FieldShell>{children}</FieldShell>
    </Suspense>
  );
}

function moduleNav(id: string) {
  return pulseModules.find((module) => module.id === id)?.nav ?? [];
}

function navForField(profile: NonNullable<Awaited<ReturnType<typeof getCurrentProfile>>>, role: string, isOwner: boolean) {
  if (role === "engineer") return ENGINEER_NAV;
  if (canUseOperations(profile)) return visibleNav(moduleNav("operations"), profile, isOwner);
  if (canUseSales(profile)) return visibleNav(moduleNav("sales"), profile, isOwner);
  return visibleNav(moduleNav("people"), profile, isOwner);
}

async function FieldShell({ children }: { children: ReactNode }) {
  if (!isSupabaseConfigured() && !isFixtureMode()) return children;
  const profile = await getCurrentProfile();
  if (!profile?.access_granted || !profile.is_active) return children;
  let role = "none";
  try {
    role = await fieldRole();
  } catch {
    role = "none";
  }
  const audience = visitAudience(role);
  let isOwner = profile.workspace_role === "owner";
  let notifications: BellItem[] = [];
  try {
    isOwner = (await getOfficeContext()).is_owner;
  } catch {
    isOwner = profile.workspace_role === "owner";
  }
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
  return (
    <AppShell profile={profile} pending={0} unread={notifications.filter((item) => !item.read).length} isOwner={isOwner} nav={navForField(profile, role, isOwner)} notifications={notifications} fieldEngineer={role === "engineer"} ownerNotice={await ownerTwoStepNotice()}>
      {children}
    </AppShell>
  );
}
