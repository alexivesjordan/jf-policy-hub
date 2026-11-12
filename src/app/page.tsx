import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Launcher } from "@/components/launcher";
import { homeRedirect } from "@/lib/access";
import { getCurrentProfile } from "@/lib/auth";
import { isFixtureMode, isSupabaseConfigured } from "@/lib/env";

export const metadata = {
  title: "Jordan Pulse",
};

export default function HomePage() {
  return (
    <Suspense fallback={<HomeFallback />}>
      <HomeGate />
    </Suspense>
  );
}

async function HomeGate() {
  await connection();
  if (!isSupabaseConfigured() && !isFixtureMode()) return <Launcher profile={null} />;
  const profile = await getCurrentProfile();
  const destination = homeRedirect(profile);
  if (destination) redirect(destination);
  return <Launcher profile={profile} />;
}

function HomeFallback() {
  return (
    <div className="min-h-screen bg-paper px-5 py-5" aria-busy="true" aria-label="Loading Jordan Pulse">
      <div className="mx-auto w-full max-w-5xl">
        <div className="h-4 w-32 rounded bg-line" />
        <div className="mx-auto mt-16 h-10 w-64 max-w-full rounded bg-line" />
        <div className="mx-auto mt-4 h-4 w-80 max-w-full rounded bg-line" />
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <div className="h-28 rounded-2xl border border-line bg-card" />
          <div className="h-28 rounded-2xl border border-line bg-card" />
          <div className="h-28 rounded-2xl border border-line bg-card" />
          <div className="h-28 rounded-2xl border border-line bg-card" />
        </div>
      </div>
    </div>
  );
}
