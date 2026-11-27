import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/pulse/page-header";
import { PageSkeleton } from "@/components/pulse/states";
import { saveSupplySettings } from "@/features/supply/actions";
import { loadSettings } from "@/features/supply/queries";
import { canAdminSupply } from "@/lib/access";
import { getCurrentProfile } from "@/lib/auth";

export const metadata = { title: "Supply settings" };

const field = "h-11 w-full rounded-2xl border border-line bg-field px-3 text-base";

export default function SupplySettingsPage() {
  return <Suspense fallback={<PageSkeleton />}><Settings /></Suspense>;
}

async function Settings() {
  await connection();
  const profile = await getCurrentProfile();
  if (!profile || !canAdminSupply(profile)) redirect("/no-access");
  const settings = await loadSettings();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Pulse Supply" title="Settings" />
      <form action={saveSupplySettings} className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">Service level<input name="serviceLevel" type="number" min={0.5} max={0.999} step={0.001} defaultValue={settings.serviceLevel} className={field} /></label>
        <label className="text-sm font-semibold">Review days<input name="reviewDays" type="number" min={1} defaultValue={settings.reviewDays} className={field} /></label>
        <label className="text-sm font-semibold">Default lead time<input name="defaultLeadTimeDays" type="number" min={0} defaultValue={settings.defaultLeadTimeDays} className={field} /></label>
        <label className="text-sm font-semibold">Forecast months<input name="forecastMonths" type="number" min={1} max={24} defaultValue={settings.forecastMonths} className={field} /></label>
        <label className="text-sm font-semibold">SMA window<input name="smaWindow" type="number" min={1} defaultValue={settings.smaWindow} className={field} /></label>
        <label className="text-sm font-semibold">Croston alpha<input name="crostonAlpha" type="number" min={0.01} max={0.9} step={0.01} defaultValue={settings.crostonAlpha} className={field} /></label>
        <label className="text-sm font-semibold">First lookback months<input name="initialLookbackMonths" type="number" min={1} defaultValue={settings.initialLookbackMonths} className={field} /></label>
        <label className="text-sm font-semibold">Stock location<input name="stockLocation" defaultValue={settings.stockLocation ?? ""} className={field} /></label>
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold sm:col-span-2"><input name="zeroStockAlert" type="checkbox" defaultChecked={settings.zeroStockAlert} /> Zero-stock alert</label>
        <button className="inline-flex min-h-11 items-center justify-center rounded-full bg-red px-4 text-sm font-semibold text-white sm:col-span-2" type="submit">Save settings</button>
      </form>
    </div>
  );
}
