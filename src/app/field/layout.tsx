import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { fieldRole } from "@/features/field/queries";
import { getOfficeContext } from "@/features/operations/queries";
import { canUseOperations, canUseSales } from "@/lib/access";
import { getCurrentProfile } from "@/lib/auth";
import { isFixtureMode, isSupabaseConfigured } from "@/lib/env";
import { ENGINEER_NAV, visibleNav } from "@/lib/shell-nav";
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
  let isOwner = profile.workspace_role === "owner";
  try {
    isOwner = (await getOfficeContext()).is_owner;
  } catch {
    isOwner = profile.workspace_role === "owner";
  }
  return (
    <AppShell profile={profile} pending={0} unread={0} isOwner={isOwner} nav={navForField(profile, role, isOwner)}>
      {children}
    </AppShell>
  );
}
