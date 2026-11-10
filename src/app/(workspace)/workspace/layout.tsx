import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { requireWorkspaceAdmin } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";

export const instant = false;

const nav = [
  { href: "/workspace", label: "Overview" },
  { href: "/workspace/users", label: "Users" },
  { href: "/workspace/teams", label: "Teams" },
  { href: "/workspace/roles", label: "Roles" },
];

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-grey">Jordan Pulse</p>
        <h1 className="font-display mt-2 text-4xl">Workspace needs a database connection</h1>
      </main>
    );
  }
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <WorkspaceShell>{children}</WorkspaceShell>
    </Suspense>
  );
}

async function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const profile = await requireWorkspaceAdmin();
  return (
    <AppShell profile={profile} pending={0} unread={0} nav={nav}>
      {children}
    </AppShell>
  );
}
