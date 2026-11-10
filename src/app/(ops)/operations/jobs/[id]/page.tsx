import Link from "next/link";
import { notFound } from "next/navigation";
import { AvailabilityCalendar } from "@/components/availability-calendar";
import { PriceWorkings } from "@/components/price-workings";
import { RepViewToggle } from "@/components/rep-view-toggle";
import { Badge, Card } from "@/components/ui";
import { AccessLinkButton } from "@/components/access-link-button";
import { RequirementOverrideForm } from "@/components/requirement-override-form";
import { getJob, getJobRequirements, getOfficeContext } from "@/features/operations/queries";
import { createClient } from "@/lib/supabase/server";
import type { QuoteBreakdown } from "@/lib/pricer/breakdown";
import { canOverrideRequirements } from "@/lib/pulse/requirements";
import { formatDate, formatTimestamp } from "@/lib/format";
import { requireOperationsUser } from "@/lib/auth";

export const metadata = { title: "Job" };

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOperationsUser();
  const context = await getOfficeContext();
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  let job: Awaited<ReturnType<typeof getJob>> = null;
  try {
    job = await getJob(id);
  } catch {
    notFound();
  }
  if (!job) notFound();
  const requirements = await getJobRequirements(id).catch(() => null);
  const internal = context.is_owner || context.ops_role === "install_lead" || context.ops_role === "admin_owner" || context.ops_role === "ops_manager";
  const canPreviewSales = context.is_owner || context.ops_role === "admin_owner" || context.ops_role === "ops_manager";
  const canOverride = canOverrideRequirements({ opsRole: context.ops_role, isOwner: context.is_owner });
  const workings = internal ? await (await createClient()).rpc("orbit_job_workings", { p_job_id: id }) : { data: null };
  const saved = workings.data as { breakdown?: QuoteBreakdown; flags?: string[]; notice?: string | null; customerPrice?: number | null; segment?: string | null; markup?: number | null } | null;

  const address = [job.site?.address_line1, job.site?.city, job.site?.postcode].filter(Boolean).join(", ");
  const latestQuote = job.quote_versions[0];
  const salesPrice = saved?.customerPrice ?? latestQuote?.customer_price ?? null;
  const salesCost = latestQuote?.internal_cost ?? null;
  const salesMargin = salesPrice != null && salesCost != null && salesPrice !== 0 ? (salesPrice - salesCost) / salesPrice : null;

  const record = (
    <>
      {job.fixture ? (
        <p className="rounded-3xl border border-line bg-card px-5 py-4 text-sm leading-6 text-ink/80">
          FIXTURE / not production data. This job was not created from Cin7. The segment and customer type below are demo labels, not a Cin7 field mapping.
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="font-display text-2xl">Status</h2>
          <p className="mt-3">
            <Badge tone="active">{job.status_label}</Badge>
          </p>
          <dl className="mt-4 space-y-2 text-sm">
            <Row label="Type" value={job.job_type} />
            <Row label="Delivered by" value={job.delivered_by === "in_house" ? "In house" : "Subcontractor"} />
            <Row label="Number" value={job.cin7_number ?? "Not set"} />
            <Row label="Quote number" value={job.cin7_quote_number ?? "Not set"} />
            <Row label="Order number" value={job.cin7_order_number ?? "Not set"} />
            <Row label="Booked" value={job.booked_date ? formatDate(job.booked_date) : "Not booked"} />
            <Row label="Arrival" value={job.arrival_window ?? "Not set"} />
            <Row label="Big install" value={job.big_install ? "Yes" : "No"} />
          </dl>
          {job.hold_reason ? (
            <p className="mt-4 text-sm text-ink/80">
              On hold: {job.hold_reason}
              {job.hold_review_date ? ` Review ${formatDate(job.hold_review_date)}.` : ""}
            </p>
          ) : null}
          {job.lost_reason ? <p className="mt-4 text-sm text-ink/80">Lost / cancelled: {job.lost_reason}</p> : null}
        </Card>
        <Card>
          <h2 className="font-display text-2xl">Customer and site</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <Row label="Customer" value={job.customer.name} />
            <Row label="Stored id" value={job.customer.cin7_id} />
            <Row label="Segment" value={labelOrStub(job.customer.segment)} />
            <Row label="Customer type" value={labelOrStub(job.customer.customer_type)} />
            <Row label="Site" value={address || "Not set"} />
          </dl>
        </Card>
      </div>
    </>
  );

  return (
    <div className="space-y-6">
      <Link href="/operations/jobs" className="text-sm font-semibold text-ink underline decoration-red">
        All jobs
      </Link>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-4xl">{job.customer.name}</h1>
          {job.fixture ? <Badge tone="pending">Fixture</Badge> : null}
        </div>
        <p className="mt-2 text-ink/70">Status is read-only. The server changes it when the rules are met.</p>
      </div>

      {internal ? <RepViewToggle
        enabled={canPreviewSales}
        full={
          <>
            {saved?.breakdown && saved.customerPrice != null ? (
              <PriceWorkings
                breakdown={saved.breakdown}
                notice={saved.notice ?? null}
                customerPrice={saved.customerPrice}
                segment={saved.segment ?? null}
                markup={saved.markup ?? null}
                flags={saved.flags ?? []}
              />
            ) : null}
            {requirements && internal ? (
              <Card>
                <h2 className="font-display text-2xl">Required resources</h2>
                <p className="mt-2 text-sm text-grey">
                  {requirements.overridden ? "Overridden by the office." : "Set by the pricer."} A sales rep cannot edit these.
                </p>
                <ul className="mt-3 space-y-1 text-sm text-ink">
                  <li>{requirements.installers} installers</li>
                  <li>{requirements.licensed_drivers} licensed drivers</li>
                  <li>{requirements.van_count} {requirements.van_size === "crafter" ? "Crafter" : "small van"}</li>
                  <li>Stair climber {requirements.stair_climber ? "yes" : "no"}</li>
                </ul>
                {requirements.conflict ? (
                  <p className="mt-3 text-sm text-ink">{requirements.conflict_detail ?? "The pencilled day no longer covers these resources."}</p>
                ) : null}
                <Link href={`/operations/jobs/${job.id}/schedule`} className="mt-4 inline-block text-sm font-semibold text-ink underline decoration-red">
                  Pencil a day
                </Link>
                {canOverride ? (
                  <div className="mt-6">
                    <RequirementOverrideForm
                      jobId={job.id}
                      requirements={{
                        installers: requirements.installers,
                        licensedDrivers: requirements.licensed_drivers,
                        vanSize: requirements.van_size,
                        vanCount: requirements.van_count,
                        stairClimber: requirements.stair_climber,
                      }}
                    />
                  </div>
                ) : null}
              </Card>
            ) : null}
            {internal ? (
              <div className="flex flex-wrap gap-4 text-sm font-semibold">
                <Link href={`/operations/jobs/${job.id}/access`} className="underline decoration-red">Review access form</Link>
                <AccessLinkButton jobId={job.id} />
              </div>
            ) : null}
            {record}
            <Card>
              <h2 className="font-display text-2xl">Quote versions</h2>
              {job.quote_versions.length === 0 ? (
                <p className="mt-3 text-ink/70">
                  No quote versions yet. The pricer is not connected, and these fixture jobs were not priced.
                </p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {job.quote_versions.map((quote) => (
                    <li key={quote.id} className="rounded-2xl border border-line px-4 py-3 text-sm">
                      <p className="font-semibold">Mode {quote.mode} · {quote.finality}</p>
                      <p className="mt-1 text-grey">
                        Customer price {money(quote.customer_price)}
                        {quote.internal_cost != null ? ` · Internal cost ${money(quote.internal_cost)}` : ""}
                        {" · "}
                        {formatTimestamp(quote.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        }
        sales={
          <>
            <div className="rounded-3xl border border-line bg-card px-6 py-6">
              <dl className="space-y-3 text-ink">
                <div>
                  <dt className="text-sm text-grey">Order number</dt>
                  <dd className="text-2xl font-semibold">{job.cin7_order_number ?? job.cin7_number ?? "Not set"}</dd>
                </div>
                <div>
                  <dt className="text-sm text-grey">Segment</dt>
                  <dd className="text-2xl font-semibold">{labelOrStub(saved?.segment ?? job.customer.segment)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-grey">Install cost</dt>
                  <dd className="font-display text-4xl">{money(salesCost)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-grey">Recommended price</dt>
                  <dd className="font-display text-4xl">{money(salesPrice)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-grey">Margin</dt>
                  <dd className="text-2xl font-semibold">{salesMargin == null ? "—" : `${Math.round(salesMargin * 1000) / 10}%`}</dd>
                </div>
              </dl>
            </div>
            {saved?.notice ? <blockquote className="rounded-3xl border border-red bg-card px-5 py-4 text-sm leading-6 text-ink">{saved.notice}</blockquote> : null}
            <Card>
              <h2 className="font-display text-2xl">Book a day</h2>
              <div className="mt-4">
                <AvailabilityCalendar jobId={job.id} />
              </div>
            </Card>
          </>
        }
      /> : (
        <>
          {requirements ? (
            <Link href={`/operations/jobs/${job.id}/schedule`} className="inline-block text-sm font-semibold text-ink underline decoration-red">
              Pencil a day
            </Link>
          ) : null}
          {record}
          <Card>
            <h2 className="font-display text-2xl">Quote versions</h2>
            {job.quote_versions.length === 0 ? (
              <p className="mt-3 text-ink/70">No quote versions yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {job.quote_versions.map((quote) => (
                  <li key={quote.id} className="rounded-2xl border border-line px-4 py-3 text-sm">
                    <p className="font-semibold">Mode {quote.mode} · {quote.finality}</p>
                    <p className="mt-1 text-grey">Customer price {money(quote.customer_price)} · {formatTimestamp(quote.created_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function labelOrStub(value: string | null) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ");
}

function money(value: number | null) {
  if (value == null) return "Not set";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-grey">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}
