import Link from "next/link";
import type { ReactNode } from "react";
import { FieldMenuButton } from "@/components/field/menu";
import { ThemeToggle } from "@/components/theme-toggle";

export function FieldFrame({ title, back, children }: { title: string; back?: { href: string; label: string }; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur">
        <FieldMenuButton />
        {back ? (
          <Link href={back.href} className="inline-flex min-h-12 items-center text-base font-semibold">
            {back.label}
          </Link>
        ) : (
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-grey">Jordan Fitness</p>
        )}
        <h1 className="mr-auto truncate text-base font-semibold">{title}</h1>
        <ThemeToggle />
      </header>
      <main className="mx-auto w-full max-w-lg px-4 py-5">{children}</main>
    </div>
  );
}
