import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/pulse/page-header";
import { PageSkeleton } from "@/components/pulse/states";
import { canManageWorkspace } from "@/lib/access";
import { loadHrSettings } from "@/features/hr/queries";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "HR settings" };

export default function HrSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Settings />
    </Suspense>
  );
}

async function Settings() {
  await connection();
  const profile = await requireUser();
  if (!canManageWorkspace(profile)) redirect("/people");
  const settings = await loadHrSettings();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Jordan Pulse" title="Settings" />
      <dl className="grid gap-3 rounded-3xl border border-line bg-card p-5 text-sm sm:grid-cols-2">
        <div><dt className="text-grey">Leave year</dt><dd className="font-semibold">{settings.leaveYear}</dd></div>
        <div><dt className="text-grey">Bank holidays</dt><dd className="font-semibold">{settings.bankHolidayRule === "inside" ? "Inside the allowance" : "On top of the allowance"}</dd></div>
        <div><dt className="text-grey">Allowance</dt><dd className="font-semibold">{settings.allowance} days</dd></div>
        <div><dt className="text-grey">Carry-over cap</dt><dd className="font-semibold">{settings.carryOver} days</dd></div>
        <div><dt className="text-grey">Directors</dt><dd className="font-semibold">{settings.directors.join(", ") || "None yet"}</dd></div>
        <div><dt className="text-grey">External partners</dt><dd className="font-semibold">{settings.partners.join(", ") || "None"}</dd></div>
        <div><dt className="text-grey">Inbound email</dt><dd className="font-semibold">{settings.inbound ? "On" : "Off"}</dd></div>
      </dl>
    </div>
  );
}
