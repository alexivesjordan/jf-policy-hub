import { Suspense } from "react";
import { VansForm, type VanRow } from "@/components/vans-form";
import { PageHeader } from "@/components/pulse/page-header";
import { PageSkeleton } from "@/components/pulse/states";
import { requireOperationsUser } from "@/lib/auth";
import { canManageWorkspace } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Fleet" };

export default function FleetPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Fleet />
    </Suspense>
  );
}

async function Fleet() {
  const profile = await requireOperationsUser();
  const supabase = await createClient();
  const loaded = await supabase.rpc("install_manage_vans");
  const vans = (Array.isArray(loaded.data) ? loaded.data : []) as VanRow[];
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Pulse Operations" title="Fleet" />
      {loaded.error ? <p className="text-sm">Fleet is not available yet.</p> : null}
      <VansForm vans={vans} canEdit={canManageWorkspace(profile)} />
    </div>
  );
}
