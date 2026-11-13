import { Suspense } from "react";
import { redirect } from "next/navigation";
import { VansForm, type VanRow } from "@/components/vans-form";
import { PageHeader } from "@/components/pulse/page-header";
import { PageSkeleton } from "@/components/pulse/states";
import { requireWorkspaceAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Vans" };

export default function VansPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Vans />
    </Suspense>
  );
}

async function Vans() {
  await requireWorkspaceAdmin();
  const supabase = await createClient();
  const loaded = await supabase.rpc("install_manage_vans");
  if (loaded.error) redirect("/operations");
  const vans = (Array.isArray(loaded.data) ? loaded.data : []) as VanRow[];
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Operations" title="Vans" />
      <VansForm vans={vans} />
    </div>
  );
}
