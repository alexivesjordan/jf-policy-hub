import { redirect } from "next/navigation";
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
    <Suspense fallback={<Launcher profile={null} />}>
      <HomeGate />
    </Suspense>
  );
}

async function HomeGate() {
  if (!isSupabaseConfigured() && !isFixtureMode()) return <Launcher profile={null} />;
  const profile = await getCurrentProfile();
  const destination = homeRedirect(profile);
  if (destination) redirect(destination);
  return <Launcher profile={profile} />;
}
