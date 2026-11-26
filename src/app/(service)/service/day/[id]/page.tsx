import Link from "next/link";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import type { VisitScreen } from "@/components/field/visit-flow";
import { MyDayStop } from "@/components/service/my-day";
import { listActiveVans, mySignature } from "@/features/field/queries";
import { loadMyServiceDay, loadServiceSheet, loadServiceVisit, type ServiceVisit } from "@/features/service/queries";
import { canUseService, moduleAllows } from "@/lib/access";
import { getCurrentProfile } from "@/lib/auth";
import { formatAddress } from "@/lib/service/model";

export const metadata = { title: "Stop" };

function sheetScreen(
  stop: ServiceVisit,
  engineerName: string,
  vans: { registration: string; name: string | null }[],
  signature: { fileId: string; url: string | null } | null,
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
    submitted: false,
    engineerName,
    signatureUrl: signature?.url ?? null,
    signatureFileId: signature?.fileId ?? null,
  };
}

export default async function MyServiceStopPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/service/day");
  if (!profile.access_granted) redirect("/no-access");
  if (!profile.is_active) redirect("/account-inactive");
  const { id } = await params;
  const mine = await loadMyServiceDay();
  const own = mine.stops.find((stop) => stop.id === id) ?? null;
  if (!own && !canUseService(profile)) notFound();
  const loaded = own ? null : await loadServiceVisit(id);
  const stop = own ?? loaded?.visit ?? null;
  if (!stop) notFound();
  const sheet = await loadServiceSheet(id);
  const canComplete = Boolean(own) || moduleAllows(profile, "service", "edit");
  const flow = !sheet?.submitted && canComplete
    ? sheetScreen(
        stop,
        profile.full_name || "",
        await listActiveVans(),
        await mySignature().catch(() => null),
      )
    : null;
  return (
    <div className="space-y-4">
      <Link href="/service/day" className="inline-flex min-h-11 items-center text-sm font-semibold underline">My day</Link>
      <MyDayStop stop={stop} sheet={sheet} flow={flow} />
    </div>
  );
}
