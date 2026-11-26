import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { OpportunityCard } from "@/components/radar/opportunity-card";
import { PageHeader } from "@/components/pulse/page-header";
import { PageSkeleton } from "@/components/pulse/states";
import { Button, Field, Input } from "@/components/pulse/ui";
import { canEditRadar, requireRadarUser } from "@/features/radar/access";
import { formatWhen, loadRadarQueue, RADAR_QUEUES } from "@/features/radar/queries";
import { createClient } from "@/lib/supabase/server";
import { oneParam } from "@/lib/utils";
import type { RadarStatus } from "@/features/radar/types";

export const metadata = { title: "Opportunity Radar" };

const UUID = /^[0-9a-f-]{36}$/i;

export default function RadarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RadarScreen searchParams={searchParams} />
    </Suspense>
  );
}

function queueFrom(value: string | null): RadarStatus {
  if (value === "worth_pursuing" || value === "dismissed" || value === "pushed_to_hubspot" || value === "new") return value;
  return "new";
}

async function RadarScreen({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const profile = await requireRadarUser();
  const params = await searchParams;
  const requested = oneParam(params.notice) ?? "";
  const notice = UUID.test(requested) ? requested : null;
  const queue = await noticeQueue(notice, queueFrom(oneParam(params.queue) ?? null));
  const search = (oneParam(params.q) ?? "").slice(0, 80);
  const [radar, admin] = await Promise.all([
    loadRadarQueue({ queue, search, notice }),
    settingsAdmin(),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pulse Sales"
        title="Opportunity Radar"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {radar.updatedAt ? <p className="text-sm text-grey">Updated {formatWhen(radar.updatedAt)}</p> : null}
            {admin ? <Link href="/sales/radar/settings" className="inline-flex min-h-11 items-center text-sm font-semibold underline decoration-primary">Settings</Link> : null}
          </div>
        }
      />
      <div className="flex flex-wrap gap-2">
        {RADAR_QUEUES.map((item) => {
          const active = item.id === queue;
          const count = radar.counts[item.id] ?? 0;
          return (
            <Link
              key={item.id}
              href={`/sales/radar?queue=${item.id}`}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ${active ? "bg-primary text-primary-foreground" : "border border-line bg-card text-ink"}`}
            >
              {item.label} {count}
            </Link>
          );
        })}
      </div>
      <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <input type="hidden" name="queue" value={queue} />
        <Field label="Search">
          <Input name="q" defaultValue={search} />
        </Field>
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      {radar.error ? <p role="alert" className="text-sm">{radar.error}</p> : null}
      {!radar.error && radar.cards.length === 0 ? <p className="rounded-3xl border border-line bg-card p-5 text-sm text-grey">No opportunities in this queue.</p> : null}
      <div className="space-y-4">
        {radar.cards.map((item) => (
          <OpportunityCard key={item.id} item={item} canEdit={canEditRadar(profile)} owners={radar.owners} />
        ))}
      </div>
    </div>
  );
}

async function noticeQueue(notice: string | null, fallback: RadarStatus): Promise<RadarStatus> {
  if (!notice) return fallback;
  const supabase = await createClient();
  const { data } = await supabase.from("radar_opportunities").select("status").eq("id", notice).maybeSingle();
  const status = data && typeof data === "object" ? (data as { status?: string }).status : null;
  if (status === "new" || status === "worth_pursuing" || status === "dismissed" || status === "pushed_to_hubspot") return status;
  return fallback;
}

async function settingsAdmin() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("workspace_is_admin");
  return !error && data === true;
}
