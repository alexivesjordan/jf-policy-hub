import { Suspense } from "react";
import { CategoryDefaultEditor, CategoryGapEditor, SkuEffortEditor, SyncProductsButton } from "@/components/effort-table";
import { PricingForm, TermsForm } from "@/components/operations-forms";
import { Card } from "@/components/pulse/ui";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/pulse/states";
import { getOfficeContext, listCategoriesWithoutDefault, listCin7CategoryDefaults, listSkuEffort, readOwnerSettings, readTerms } from "@/features/operations/queries";
import { requireOperationsUser } from "@/lib/auth";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export const metadata = { title: "Effort table" };

export default function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SettingsBody searchParams={searchParams} />
    </Suspense>
  );
}

async function SettingsBody({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperationsUser();
  const context = await getOfficeContext();
  const params = await searchParams;
  const search = one(params.search);
  const category = one(params.category);
  const status = one(params.status);
  const needs = one(params.needs);
  const page = Math.max(0, Number(one(params.page)) || 0);
  if (!context.is_owner) {
    return (
      <PageHeader
        eyebrow="Pulse Operations"
        title="Effort table"
        description="Only the named owner can view and change pricing and the charges grid."
      />
    );
  }

  const [pricing, terms, categories, gaps, effort] = await Promise.all([
    readOwnerSettings(),
    readTerms(),
    listCin7CategoryDefaults().catch(() => []),
    listCategoriesWithoutDefault().catch(() => []),
    listSkuEffort({ search, category, status, needsAssembly: needs, offset: page * 50 }).catch(() => null),
  ]);
  const lines = terms?.charges_grid.lines ?? [];
  const schedule = terms?.cancellation_schedule.rows ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Pulse Operations"
        title="Effort table"
        description="Markups, category defaults, and how long each product takes to install."
        actions={<SyncProductsButton />}
      />

      <Card>
        <h2 className="font-display text-2xl">Markups and floors</h2>
        <div className="mt-4">
          {pricing ? (
            <PricingForm
              version={Number(pricing.version)}
              markups={{
                independent: Number(pricing.markup_independent),
                franchisee: Number(pricing.markup_franchisee),
                trade: Number(pricing.markup_trade),
                corporate: Number(pricing.markup_big_corporate),
              }}
              minJobCharge={pricing.min_job_charge == null ? null : Number(pricing.min_job_charge)}
              marginFloor={pricing.margin_floor_pct == null ? null : Number(pricing.margin_floor_pct)}
              depositFraction={Number(pricing.custom_deposit_fraction)}
              largeOrderThreshold={Number(pricing.large_order_threshold)}
              roundingHours={Number(pricing.variation_rounding_hours)}
              sledTrackWidthM={pricing.sled_track_width_m == null ? null : Number(pricing.sled_track_width_m)}
              sledBaseMinutes={pricing.sled_base_minutes == null ? 180 : Number(pricing.sled_base_minutes)}
              sledBaseLengthM={pricing.sled_base_length_m == null ? 10 : Number(pricing.sled_base_length_m)}
              sledExtraMinutesPerMetre={pricing.sled_extra_minutes_per_m == null ? 6 : Number(pricing.sled_extra_minutes_per_m)}
            />
          ) : (
            <EmptyState title="Pricing settings are not configured" description="Ask the owner to apply the pricing migration, then reload this page." />
          )}
        </div>
        {pricing ? (
          <p className="mt-4 text-sm text-grey">
            Minimum job charge: {pricing.min_job_charge == null ? "Not configured" : `£${pricing.min_job_charge}`}
            . Margin floor: {pricing.margin_floor_pct == null ? "Not configured" : `${Math.round(Number(pricing.margin_floor_pct) * 1000) / 10}%`}.
          </p>
        ) : null}
      </Card>

      <Card>
        <h2 className="font-display text-2xl">Cin7 category defaults</h2>
        <p className="mt-2 text-sm text-grey">
          Used when a SKU has not been confirmed. Seeds are suggestions. Other stays unknown and prices as a 2-man, 2-hour assembly.
        </p>
        <div className="mt-4">
          {categories.length > 0 ? <CategoryDefaultEditor rows={categories} /> : <p className="text-sm text-ink">Apply the effort migration to seed category defaults.</p>}
        </div>
        <h3 className="font-display mt-8 text-xl">Categories with no default</h3>
        <p className="mt-2 text-sm text-grey">
          {gaps.length} categories, {gaps.reduce((sum, row) => sum + Number(row.sku_count), 0)} SKUs. These price as a 2-man, 2-hour assembly until you set one. Leave a row unknown to skip it.
        </p>
        <div className="mt-4">
          <CategoryGapEditor rows={gaps} />
        </div>
      </Card>

      <Card>
        <div>
          <h2 className="font-display text-2xl">Effort table</h2>
          <p className="mt-2 max-w-2xl text-sm text-grey">
            How long each product takes to install. {effort ? `${effort.review_count} still need a check.` : ""}
          </p>
        </div>
        <div className="mt-4">
          {effort ? (
            <SkuEffortEditor
              rows={effort.rows ?? []}
              page={page}
              total={effort.total ?? 0}
              filters={{ search, category, status, needsAssembly: needs }}
              categories={effort.categories ?? categories.map((row) => row.category)}
            />
          ) : (
            <ErrorState title="The effort table is not available" description="Apply the effort migration, then reload this page." />
          )}
        </div>
      </Card>

      <Card>
        <h2 className="font-display text-2xl">Charges grid</h2>
        <p className="mt-2 text-sm text-grey">
          {terms ? `Version ${terms.version_label}. ${terms.is_live ? "Marked live." : "Not marked live."}` : "No terms version yet."}
        </p>
        <div className="mt-4">{lines.length > 0 ? <TermsForm lines={lines} /> : null}</div>
      </Card>

      <Card>
        <h2 className="font-display text-2xl">Cancellation schedule</h2>
        <p className="mt-2 text-sm text-grey">Shown from the current terms version. Editing it is not part of this screen.</p>
        <ul className="mt-4 space-y-2 text-sm">
          {schedule.map((row) => (
            <li key={row.notice} className="flex justify-between gap-4 border-b border-line py-2">
              <span>{row.notice}</span>
              <span className="text-grey">
                {row.charge_pct}%{row.plus_third_party_costs ? " plus third-party costs" : ""}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
