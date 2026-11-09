import Link from "next/link";
import { ModuleGlyph } from "@/components/module-icon";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { canUsePeople } from "@/lib/access";
import type { Profile } from "@/lib/types";
import { orbitModules } from "@/modules/registry";
import { cn } from "@/lib/utils";

export function Launcher({ profile }: { profile: Profile | null }) {
  return (
    <div className="orbit-grid min-h-screen text-ink">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-grey">Jordan Fitness</p>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {profile ? <UserMenu profile={profile} placement="down" className="w-56" /> : null}
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-col px-5 pb-16 pt-6 md:pt-10">
        <div className="text-center">
          <h1 className="font-display text-4xl font-semibold tracking-wide text-ink md:text-5xl">JORDAN ORBIT</h1>
          <p className="mt-3 text-base text-grey md:text-lg">AI operations and automation platform</p>
        </div>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {orbitModules.map((module) => {
            const soon = module.status === "coming-soon";
            const locked = module.id === "people" && profile ? !canUsePeople(profile) : false;
            if (locked) {
              return (
                <li key={module.id}>
                  <div className="flex min-h-28 items-center gap-4 rounded-2xl border border-line bg-card px-5 py-4 text-ink">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-line text-grey">
                      <ModuleGlyph name={module.icon} className="h-6 w-6" />
                    </span>
                    <span className="min-w-0">
                      <span className="text-lg font-semibold text-ink">{module.name}</span>
                      <span className="mt-0.5 block text-sm text-grey">Needs an Orbit People licence</span>
                    </span>
                  </div>
                </li>
              );
            }
            return (
              <li key={module.id}>
                <Link
                  href={module.href}
                  className={cn(
                    "group flex min-h-28 items-center gap-4 rounded-2xl border px-5 py-4 transition",
                    soon
                      ? "border-line bg-card text-ink hover:border-white/30"
                      : "border-red/70 bg-card shadow-[0_0_0_1px_rgba(206,0,55,0.25)] hover:border-red hover:shadow-[0_0_28px_rgba(206,0,55,0.28)]",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border",
                      soon ? "border-line text-grey" : "border-red/60 bg-red/15 text-white",
                    )}
                  >
                    <ModuleGlyph name={module.icon} className="h-6 w-6" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-semibold text-ink">{module.name}</span>
                      {soon ? (
                        <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-grey">
                          Coming soon
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-sm text-grey">{module.tagline}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
