"use client";

import { createContext, useContext, type ReactNode } from "react";
import { MobileNav } from "@/components/app-shell";
import type { Profile } from "@/lib/types";
import type { ModuleNavItem } from "@/modules/registry";

type FieldMenu = {
  profile: Profile;
  items: ModuleNavItem[];
  currentId?: string;
};

const FieldMenuContext = createContext<FieldMenu | null>(null);

export function FieldMenuProvider({ value, children }: { value: FieldMenu; children: ReactNode }) {
  return <FieldMenuContext.Provider value={value}>{children}</FieldMenuContext.Provider>;
}

/** Burger for the field header. Hidden from md up so the desktop header stays as it is. */
export function FieldMenuButton() {
  const menu = useContext(FieldMenuContext);
  if (!menu) return null;
  return (
    <MobileNav
      items={menu.items}
      counts={{ pending: 0, unread: 0 }}
      title="My jobs"
      profile={menu.profile}
      currentId={menu.currentId}
    />
  );
}
