import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import type { VisitScreen } from "@/components/field/visit-flow";
import { ServiceJobView } from "@/components/service/job-view";
import { fieldRole, listActiveVans, mySignature } from "@/features/field/queries";
import { loadMyServiceDay, loadServiceSheet, loadServiceVisit, type ServiceVisit } from "@/features/service/queries";
import { moduleAllows } from "@/lib/access";
import { getCurrentProfile } from "@/lib/auth";
import { formatAddress } from "@/lib/service/model";
import { plannerVisitPath, visitAudience } from "@/lib/service/visit-route";

export const instant = false;
export const metadata = { title: "Job" };

function sheetScreen(
  stop: ServiceVisit,
  engineerName: string,
  vans: { registration: string; name: string | null }[],
  signature: { fileId: string; url: string | null } | null,
  submitted: boolean,
): VisitScreen {
  return {
    installId: stop.id,
    token: null,
    canInvite: false,
    record: "service",
    customerName: stop.customerName,
    siteAddress: formatAddress(stop) || null,
    contactName: stop.contactName || stop.customerName,
    phone: stop.contactPhone,
    address: formatAddress(stop),
    orderNo: stop.cin7OrderNumber,
    startOn: stop.visitOn,
    lines: stop.lines.map((line) => ({
      sku: line.sku,
      description: line.description || line.fault || line.sku || "Item",
      productLine: null,
      category: null,
      qty: 1,
    })),
    vans,
    risk: null,
    submitted,
    engineerName,
    signatureUrl: signature?.url ?? null,
    signatureFileId: signature?.fileId ?? null,
  };
}

export default async function ServiceJobPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const profile = await getCurrentProfile();
  const { id } = await params;
  if (!profile) redirect(`/login?next=/service/job/${id}`);
  if (!profile.access_granted) redirect("/no-access");
  if (!profile.is_active) redirect("/account-inactive");
  let role = "none";
  try {
    role = await fieldRole();
  } catch {
    role = "none";
  }
  const audience = visitAudience(role);
  const mine = await loadMyServiceDay();
  const own = mine.stops.find((stop) => stop.id === id) ?? null;
  const loaded = own ? null : await loadServiceVisit(id);
  const stop = own ?? loaded?.visit ?? null;
  if (!stop) notFound();
  const sheet = await loadServiceSheet(id);
  const canComplete = audience === "engineer" || moduleAllows(profile, "service", "edit");
  const flow = !sheet?.submitted && canComplete
    ? sheetScreen(
        stop,
        profile.full_name || "",
        await listActiveVans(),
        await mySignature().catch(() => null),
        false,
      )
    : null;
  return (
    <ServiceJobView
      stop={stop}
      sheet={sheet}
      flow={flow}
      back={audience === "engineer" ? { href: "/service/day", label: "My day" } : { href: plannerVisitPath(id), label: "Booking" }}
      canUpdate={canComplete}
    />
  );
}
