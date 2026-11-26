import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { RadarSettingsForm } from "@/components/radar/radar-settings-form";
import { PageHeader } from "@/components/pulse/page-header";
import { PageSkeleton } from "@/components/pulse/states";
import { requireRadarUser } from "@/features/radar/access";
import { loadRadarSettings } from "@/features/radar/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Radar settings" };

export default function RadarSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SettingsScreen />
    </Suspense>
  );
}

async function SettingsScreen() {
  await connection();
  await requireRadarUser();
  const supabase = await createClient();
  const admin = await supabase.rpc("workspace_is_admin");
  if (admin.error || admin.data !== true) redirect("/sales/radar");
  const settings = await loadRadarSettings();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow="Pulse Sales" title="Radar settings" />
      <section className="rounded-3xl border border-line bg-card p-5">
        <RadarSettingsForm settings={settings} />
      </section>
    </div>
  );
}
