import { connection } from "next/server";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { FieldFrame } from "@/components/field/frame";
import { VisitFlow, type VisitScreen } from "@/components/field/visit-flow";
import { mySignature, visitContext } from "@/features/field/queries";
import { getCurrentProfile } from "@/lib/auth";
import { isFixtureMode, isSupabaseConfigured } from "@/lib/env";

export const instant = false;
export const metadata = { title: "Job" };

export default function FieldJobPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<FieldFrame title="Job" back={{ href: "/field", label: "Jobs" }}><p className="text-grey">Loading...</p></FieldFrame>}>
      <Job params={params} />
    </Suspense>
  );
}

async function Job({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!isSupabaseConfigured() && !isFixtureMode()) {
    return <FieldFrame title="Job" back={{ href: "/field", label: "Jobs" }}><p>Add the Supabase keys, then open the job again.</p></FieldFrame>;
  }
  const profile = await getCurrentProfile();
  if (!profile) redirect(`/login?next=/field/${id}`);
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
    return <FieldFrame title="Job" back={{ href: "/field", label: "Jobs" }}><p>{problem ?? "That job was not found."}</p></FieldFrame>;
  }
  const signature = visit.submitted ? null : await mySignature().catch(() => null);
  const screen: VisitScreen = {
    installId: visit.job.id,
    token: null,
    canInvite: visit.role === "admin" || visit.role === "ops",
    customerName: visit.job.customerName,
    siteAddress: visit.job.siteAddress,
    contactName: visit.job.contactName ?? visit.job.customerName,
    phone: visit.job.contactPhone ?? "",
    address: visit.job.siteAddress ?? "",
    orderNo: visit.job.orderNumber,
    startOn: visit.job.startOn,
    lines: visit.lines,
    risk: visit.risk,
    submitted: visit.submitted || visit.job.status === "completed",
    engineerName: visit.engineerName,
    signatureUrl: signature?.url ?? null,
    signatureFileId: signature?.fileId ?? null,
  };
  return (
    <FieldFrame title={visit.job.orderNumber} back={{ href: "/field", label: "Jobs" }}>
      <VisitFlow screen={screen} />
    </FieldFrame>
  );
}
