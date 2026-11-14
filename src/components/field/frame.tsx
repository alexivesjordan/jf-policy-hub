import Link from "next/link";
import type { ReactNode } from "react";

export function FieldFrame({ title, back, children }: { title: string; back?: { href: string; label: string }; children: ReactNode }) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {back ? (
          <Link href={back.href} className="inline-flex min-h-11 items-center text-sm font-semibold underline">
            {back.label}
          </Link>
        ) : null}
        <h1 className="truncate text-xl font-semibold">{title}</h1>
      </div>
      {children}
    </div>
  );
}
