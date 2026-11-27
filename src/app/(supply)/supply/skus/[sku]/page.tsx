import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/pulse/page-header";
import { PageSkeleton } from "@/components/pulse/states";
import { saveSku } from "@/features/supply/actions";
import { loadSku, londonTime } from "@/features/supply/queries";
import { canEditSupply } from "@/lib/access";
import { getCurrentProfile } from "@/lib/auth";

export const metadata = { title: "SKU" };

const field = "h-11 w-full rounded-2xl border border-line bg-field px-3 text-base";

export default function SkuPage({ params }: { params: Promise<{ sku: string }> }) {
  return <Suspense fallback={<PageSkeleton />}><Sku params={params} /></Suspense>;
}

async function Sku({ params }: { params: Promise<{ sku: string }> }) {
  await connection();
  const sku = decodeURIComponent((await params).sku);
  const profile = await getCurrentProfile();
  let row: Awaited<ReturnType<typeof loadSku>>;
  try {
    row = await loadSku(sku);
  } catch {
    notFound();
  }
  const months = chartMonths(row.demand);
  const max = Math.max(1, ...months.map((month) => month.cin7 + month.orderwise));
  const canEdit = profile ? canEditSupply(profile) : false;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Pulse Supply" title={row.sku} actions={<Link className="inline-flex min-h-11 items-center text-sm font-semibold underline" href="/supply/skus">SKUs</Link>} />
      {row.label ? <p className="text-sm text-grey">{row.label}</p> : null}
      <dl className="grid gap-3 sm:grid-cols-4">
        <Stat label="On hand" value={row.onHand} />
        <Stat label="Available" value={row.available} />
        <Stat label="On order" value={row.onOrder} />
        <Stat label="Lead time" value={row.leadTimeDays == null ? "—" : `${row.leadTimeDays} days`} detail={row.leadTimeSource ?? "Not set"} />
      </dl>
      <p className="text-sm text-grey">Stock captured {londonTime(row.capturedAt)}</p>
      {months.length === 0 ? <p className="text-sm text-grey">No demand yet</p> : (
        <div>
          <div className="flex h-36 items-end gap-px" aria-label="Monthly demand">
            {months.map((month) => (
              <div key={month.month} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${month.month}: Cin7 ${month.cin7}, Orderwise ${month.orderwise}`}>
                <div className="bg-red" style={{ height: `${(month.cin7 / max) * 100}%` }} />
                <div className="bg-ink/40" style={{ height: `${(month.orderwise / max) * 100}%` }} />
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-grey"><span className="text-red">Cin7</span> · Orderwise</p>
        </div>
      )}
      {row.forecast.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          {row.forecast.map((item) => (
            <li key={item.month} className="rounded-2xl border border-line px-3 py-2">
              <span className="block text-grey">{item.month.slice(0, 7)}</span>
              <span className="tabular-nums">{item.qty}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {canEdit ? (
        <form action={saveSku} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="sku" value={row.sku} />
          <label className="text-sm font-semibold">Lead time days<input name="leadTimeDays" type="number" min={0} defaultValue={row.leadTimeDays ?? ""} className={field} /></label>
          <label className="text-sm font-semibold">Source
            <select name="leadTimeSource" defaultValue={row.leadTimeSource ?? "manual"} className={field}>
              <option value="manual">Manual</option>
              <option value="cin7">Cin7</option>
              <option value="orderwise_po">Orderwise PO</option>
            </select>
          </label>
          <label className="text-sm font-semibold">MOQ<input name="moq" type="number" min={0} defaultValue={row.moq ?? ""} className={field} /></label>
          <label className="text-sm font-semibold">Order multiple<input name="orderMultiple" type="number" min={0} defaultValue={row.orderMultiple ?? ""} className={field} /></label>
          <label className="text-sm font-semibold">Safety days<input name="safetyDays" type="number" min={0} defaultValue={row.safetyDays ?? ""} className={field} /></label>
          <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input name="exclude" type="checkbox" defaultChecked={row.exclude} /> Exclude</label>
          <button className="inline-flex min-h-11 items-center justify-center rounded-full bg-red px-4 text-sm font-semibold text-white sm:col-span-2" type="submit">Save {row.sku}</button>
        </form>
      ) : null}
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: number | string | null; detail?: string }) {
  return (
    <div className="rounded-3xl border border-line bg-card px-4 py-3">
      <dt className="text-sm text-grey">{label}</dt>
      <dd className="font-mono text-2xl tabular-nums">{value ?? "—"}</dd>
      {detail ? <p className="text-xs text-grey">{detail}</p> : null}
    </div>
  );
}

function chartMonths(demand: { month: string; qty: number; source: "cin7" | "orderwise" }[]) {
  const map = new Map<string, { month: string; cin7: number; orderwise: number }>();
  for (const point of demand) {
    const month = point.month.slice(0, 10);
    const slot = map.get(month) ?? { month, cin7: 0, orderwise: 0 };
    slot[point.source] += Number(point.qty);
    map.set(month, slot);
  }
  return [...map.values()].sort((left, right) => left.month.localeCompare(right.month));
}
