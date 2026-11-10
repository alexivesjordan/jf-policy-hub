import Link from "next/link";
import { Badge, Card } from "@/components/pulse/ui";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState } from "@/components/pulse/states";
import { getJob, getOfficeContext } from "@/features/operations/queries";
import { loadBundledEffortTable } from "@/lib/pricer/effort-table";
import { priceVariation, type SiteProfile } from "@/lib/pricer/engine";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireOperationsUser } from "@/lib/auth";
import { notFound } from "next/navigation";

export const metadata = { title: "Access review" };

export default async function AccessReviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOperationsUser();
  const context = await getOfficeContext();
  if (!context.is_owner && context.ops_role !== "install_lead" && context.ops_role !== "admin_owner") {
    return <p className="text-ink/75">Only the install lead can review an access form.</p>;
  }
  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();
  const supabase = await createClient();
  const [submissions, linesResult] = await Promise.all([
    supabase.rpc("orbit_list_access_submissions", { p_job_id: id }),
    supabase.rpc("orbit_job_lines", { p_job_id: id }),
  ]);
  const forms = (submissions.data ?? []) as {
    id: string;
    answers: Record<string, unknown>;
    accepted_at: string | null;
    accepted_by_name: string | null;
    media_file_ids: string[];
  }[];
  const lines = (linesResult.data ?? []) as { productName: string; category: string | null; qty: number }[];
  const latest = forms[0];
  const admin = createAdminClient();
  let pricing = null as null | Record<string, number | null>;
  if (admin) {
    const snap = await admin.rpc("orbit_pricing_snapshot");
    pricing = snap.data as Record<string, number | null> | null;
  }

  let variation = null;
  if (latest && lines.length > 0 && job.customer.segment && job.site?.postcode) {
    variation = priceVariation({
      postcode: job.site.postcode,
      segment: job.customer.segment as "independent" | "franchisee" | "trade" | "big_corporate",
      lines: lines.map((line) => ({ productName: line.productName, category: line.category, qty: Number(line.qty) })),
      profile: profileFrom(latest.answers),
      pricing: pricing
        ? {
            markupIndependent: Number(pricing.markup_independent),
            markupFranchisee: Number(pricing.markup_franchisee),
            markupTrade: Number(pricing.markup_trade),
            markupBigCorporate: Number(pricing.markup_big_corporate),
            minJobCharge: pricing.min_job_charge == null ? null : Number(pricing.min_job_charge),
            marginFloorPct: pricing.margin_floor_pct == null ? null : Number(pricing.margin_floor_pct),
            largeOrderThreshold: Number(pricing.large_order_threshold),
            variationRoundingHours: Number(pricing.variation_rounding_hours),
          }
        : undefined,
      table: loadBundledEffortTable(),
    });
  }

  return (
    <div className="space-y-6">
      <Link href={`/operations/jobs/${id}`} className="text-sm font-semibold underline decoration-red">
        Back to the job
      </Link>
      <PageHeader eyebrow="Pulse Operations" title="Access review" description={`${job.customer.name}. Mode B compares the form with the best-case price.`} />
      {forms.length === 0 ? (
        <EmptyState title="No access form yet" description="The customer link collects site access before this review can compare it with the price." />
      ) : (
        <Card>
          <p className="font-semibold">Accepted by {latest?.accepted_by_name ?? "—"}</p>
          <p className="mt-2 text-sm text-grey">{latest?.media_file_ids?.length ?? 0} photo(s)</p>
          {variation?.manualPricing ? (
            <p className="mt-4 rounded-2xl border border-red px-4 py-3 text-sm">
              Manual pricing. {variation.manualReasons.join(" ")}
            </p>
          ) : null}
          {variation?.variation ? (
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-grey">Customer charge</dt><dd>{money(variation.variation.customerCharge)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-grey">Internal cost delta</dt><dd>{money(variation.variation.internalDelta)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-grey">Billed installer hours</dt><dd>{variation.variation.billedHours} at £{variation.variation.rate}</dd></div>
            </dl>
          ) : (
            <p className="mt-4 text-sm text-grey">Price the quote first so this job has lines and a segment.</p>
          )}
          {variation?.variation?.belowCost ? (
            <p className="mt-4 text-sm text-ink">The grid charge is below the internal cost delta.</p>
          ) : null}
          {variation?.bigInstall ? <Badge tone="pending">Big install — photos or a walkthrough are required before booking</Badge> : null}
          <p className="mt-3 text-xs text-grey">{variation?.variation?.roundingNote}</p>
        </Card>
      )}
    </div>
  );
}

function money(value: number | null) {
  if (value == null) return "Not auto-priced";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

function profileFrom(answers: Record<string, unknown>): SiteProfile {
  const ground = answers.groundFloor === true;
  const lift = answers.hasLift === true;
  const floor = Number(answers.floorNumber ?? 1);
  const doors = answers.doubleDoorsOrClear === true;
  const level = answers.levelStepFree === true;
  const adjacent = answers.tailLiftAdjacent === true;
  const town = answers.townCentre === true;
  return {
    stairs: ground || lift ? "none" : floor >= 2 ? "2+" : "1",
    access: !doors || lift ? "tight_or_lift" : level ? "easy" : "long_carry",
    parking: adjacent ? "adjacent" : town ? "far_or_restricted" : "short_walk",
    floorType: "concrete",
    pumpTruckRoute: ground && level && doors && adjacent,
    townCentre: town,
    openingWidthMm: typeof answers.openingWidthMm === "number" ? answers.openingWidthMm : null,
    openingHeightMm: typeof answers.openingHeightMm === "number" ? answers.openingHeightMm : null,
    outsideHours: answers.startAtEight === false,
  };
}
