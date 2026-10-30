import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ModuleGlyph } from "@/components/module-icon";
import { requireUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { getModule } from "@/modules/registry";

export default function ModulePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="min-h-screen bg-paper" />}>
      <ModuleGate params={params} />
    </Suspense>
  );
}

async function ModuleGate({ params }: { params: Promise<{ id: string }> }) {
  if (isSupabaseConfigured()) await requireUser();
  const { id } = await params;
  const orbitModule = getModule(id);
  if (!orbitModule) notFound();
  if (orbitModule.status === "active") redirect(orbitModule.href);

  return (
    <main className="orbit-grid flex min-h-screen flex-col px-6 py-8 text-ink">
      <Link href="/" className="text-sm font-semibold text-white underline decoration-red">
        All modules
      </Link>
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 text-white/70">
          <ModuleGlyph name={orbitModule.icon} className="h-7 w-7" />
        </span>
        <h1 className="font-display mt-5 text-4xl text-white">{orbitModule.name}</h1>
        <p className="mt-2 text-white/70">{orbitModule.tagline}</p>
        <p className="mt-6 text-sm uppercase tracking-[0.18em] text-grey">Coming soon</p>
        <p className="mt-3 leading-7 text-grey">
          This part of Jordan Orbit is not open yet. Orbit People is the module you can use today.
        </p>
        <Link
          href="/dashboard"
          className="mt-8 inline-flex min-h-11 w-fit items-center rounded-full bg-red px-5 font-semibold text-white"
        >
          Open Orbit People
        </Link>
      </div>
    </main>
  );
}
