import { Suspense, type ReactNode } from "react";
import { FieldMenuProvider } from "@/components/field/menu";
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
      <FieldMenuShell>{children}</FieldMenuShell>
    </Suspense>
  );
}

function moduleNav(id: string) {
  return pulseModules.find((module) => module.id === id)?.nav ?? [];
}

function navForField(profile: NonNullable<Awaited<ReturnType<typeof getCurrentProfile>>>, role: string, isOwner: boolean) {
  if (role === "engineer") return { items: ENGINEER_NAV, currentId: "operations" };
  if (canUseOperations(profile)) return { items: visibleNav(moduleNav("operations"), profile, isOwner), currentId: "operations" };
  if (canUseSales(profile)) return { items: visibleNav(moduleNav("sales"), profile, isOwner), currentId: "sales" };
  return { items: visibleNav(moduleNav("people"), profile, isOwner), currentId: "people" };
}

async function FieldMenuShell({ children }: { children: ReactNode }) {
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
  const menu = navForField(profile, role, isOwner);
  return (
    <FieldMenuProvider value={{ profile, items: menu.items, currentId: menu.currentId }}>
      {children}
    </FieldMenuProvider>
  );
}
