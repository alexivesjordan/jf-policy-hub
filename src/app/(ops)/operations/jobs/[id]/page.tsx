import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card } from "@/components/ui";
import { AccessLinkButton } from "@/components/access-link-button";
import { getJob, getOfficeContext } from "@/features/operations/queries";
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

  const address = [job.site?.address_line1, job.site?.city, job.site?.postcode].filter(Boolean).join(", ");

  return (
    <div className="space-y-6">
      <Link href="/operations/jobs" className="text-sm font-semibold text-white underline decoration-red">
        All jobs
      </Link>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-4xl">{job.customer.name}</h1>
          {job.fixture ? <Badge tone="pending">Fixture</Badge> : null}
        </div>
        <p className="mt-2 text-white/70">Status is read-only. The server changes it when the rules are met.</p>
      </div>

      {context.is_owner || context.ops_role === "install_lead" || context.ops_role === "admin_owner" ? (
        <div className="flex flex-wrap gap-4 text-sm font-semibold">
          <Link href={`/operations/jobs/${job.id}/access`} className="underline decoration-red">Review access form</Link>
          <AccessLinkButton jobId={job.id} />
        </div>
      ) : null}

      {job.fixture ? (
        <p className="rounded-3xl border border-line bg-card px-5 py-4 text-sm leading-6 text-white/80">
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
            <p className="mt-4 text-sm text-white/80">
              On hold: {job.hold_reason}
              {job.hold_review_date ? ` Review ${formatDate(job.hold_review_date)}.` : ""}
            </p>
          ) : null}
          {job.lost_reason ? <p className="mt-4 text-sm text-white/80">Lost / cancelled: {job.lost_reason}</p> : null}
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

      <Card>
        <h2 className="font-display text-2xl">Quote versions</h2>
        {job.quote_versions.length === 0 ? (
          <p className="mt-3 text-white/70">
            No quote versions yet. The pricer is not connected, and these fixture jobs were not priced.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {job.quote_versions.map((quote) => (
              <li key={quote.id} className="rounded-2xl border border-line px-4 py-3 text-sm">
                <p className="font-semibold">
                  Mode {quote.mode} · {quote.finality}
                </p>
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
      <dd className="text-right text-white">{value}</dd>
    </div>
  );
}
