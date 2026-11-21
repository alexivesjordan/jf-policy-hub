import { connection } from "next/server";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { VehicleCheckForm } from "@/components/field/vehicle-check-form";
import { FieldFrame } from "@/components/field/frame";
import { visitContext } from "@/features/field/queries";
import { getCurrentProfile } from "@/lib/auth";
import { isFixtureMode, isSupabaseConfigured } from "@/lib/env";

export const instant = false;
export const metadata = { title: "Vehicle check" };

export default function VehicleCheckPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<FieldFrame title="Vehicle check" back={{ href: "/field", label: "My jobs" }}><p className="text-grey">Loading...</p></FieldFrame>}>
      <Check params={params} />
    </Suspense>
  );
}

async function Check({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!isSupabaseConfigured() && !isFixtureMode()) {
    return <FieldFrame title="Vehicle check" back={{ href: `/field/${id}`, label: "Job" }}><p>Add the Supabase keys, then open the vehicle check again.</p></FieldFrame>;
  }
  const profile = await getCurrentProfile();
  if (!profile) redirect(`/login?next=/field/${id}/vehicle`);
  if (!profile.access_granted) redirect("/no-access");
  if (!profile.is_active) redirect("/account-inactive");
  let visit: Awaited<ReturnType<typeof visitContext>> = null;
  let problem: string | null = null;
  try {
    visit = await visitContext(id);
  } catch (error) {
    problem = error instanceof Error ? error.message : "Could not open that job.";
  }
  if (!visit) {
    return <FieldFrame title="Vehicle check" back={{ href: "/field", label: "My jobs" }}><p>{problem ?? "That job was not found."}</p></FieldFrame>;
  }
  return (
    <FieldFrame title={visit.job.orderNumber} back={{ href: `/field/${id}`, label: "Job" }}>
      <VehicleCheckForm
        installId={id}
        currentUserId={profile.id}
        drivers={visit.briefing.assignees}
        vans={visit.briefing.vans}
        defaultVanId={visit.briefing.defaultVanId}
        existing={visit.briefing.vehicleCheck}
      />
    </FieldFrame>
  );
}
