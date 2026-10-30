import { Suspense } from "react";
import { Launcher } from "@/components/launcher";
import { requireUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata = {
  title: "Jordan Orbit",
};

export default function HomePage() {
  return (
    <Suspense fallback={<Launcher profile={null} />}>
      <HomeGate />
    </Suspense>
  );
}

async function HomeGate() {
  if (!isSupabaseConfigured()) return <Launcher profile={null} />;
  const profile = await requireUser();
  return <Launcher profile={profile} />;
}
