import { CategoryDefaultEditor, CategoryGapEditor, SkuEffortEditor, SyncProductsButton } from "@/components/effort-table";
import { PricingForm, TermsForm } from "@/components/operations-forms";
import { Button, Card, Input } from "@/components/ui";
import { getOfficeContext, listCategoriesWithoutDefault, listCin7CategoryDefaults, listSkuEffort, readOwnerSettings, readTerms } from "@/features/operations/queries";
import { requireOperationsUser } from "@/lib/auth";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function pageHref(params: Record<string, string | string[] | undefined>, page: number) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const text = one(value);
    if (text && key !== "page") query.set(key, text);
  }
  query.set("page", String(page));
  return `/operations/settings?${query.toString()}`;
}

export const metadata = { title: "Pricing" };

export default async function SettingsPage({
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
      <div className="space-y-4">
        <h1 className="font-display text-4xl">Pricing</h1>
        <p className="max-w-xl text-ink/75">Only the named owner can view and change pricing and the charges grid.</p>
      </div>
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
      <div>
        <h1 className="font-display text-4xl">Pricing</h1>
        <p className="mt-2 max-w-2xl text-ink/70">
          Markups live on the pricing settings table. Each save appends a version. Minimum job charge and margin floor stay “not configured” until a number is entered.
        </p>
      </div>

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
            />
          ) : (
            <p className="text-ink/70">Pricing settings are not configured.</p>
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
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl">Effort table</h2>
            <p className="mt-2 max-w-2xl text-sm text-grey">
              One row per Cin7 SKU. Sync fills suggested rows from the category default and never changes a confirmed row.
              Needs review: {effort ? effort.review_count : "—"}.
              {effort?.name_rule_count ? ` ${effort.name_rule_count} match a name rule (pin-loaded machines built at HQ, or sled tracks at 3 hours) and stay here until confirmed.` : ""}
            </p>
          </div>
          <SyncProductsButton />
        </div>
        <form className="mt-4 flex flex-wrap items-end gap-3" method="get">
          <label className="text-sm">
            <span className="mb-1 block text-grey">Search</span>
            <Input name="search" defaultValue={search} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-grey">Cin7 category</span>
            <select name="category" defaultValue={category} className="min-h-11 rounded-2xl border border-line bg-paper px-3">
              <option value="">All</option>
              {(effort?.categories ?? categories.map((row) => row.category)).map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-grey">Status</span>
            <select name="status" defaultValue={status} className="min-h-11 rounded-2xl border border-line bg-paper px-3">
              <option value="">All</option>
              <option value="suggested">Suggested</option>
              <option value="confirmed">Confirmed</option>
              <option value="name-rule">Name rule</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-grey">Needs assembly</span>
            <select name="needs" defaultValue={needs} className="min-h-11 rounded-2xl border border-line bg-paper px-3">
              <option value="">All</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
        <div className="mt-4">
          {effort ? (
            <SkuEffortEditor rows={effort.rows ?? []} page={page} filters={{ search, category, status, needsAssembly: needs }} />
          ) : (
            <p className="text-sm text-ink">The effort table is not available until the new migration is applied.</p>
          )}
        </div>
        {effort && effort.total > (page + 1) * 50 ? (
          <p className="mt-3 text-sm">
            <a className="font-semibold underline decoration-red" href={pageHref(params, page + 1)}>Next page</a>
          </p>
        ) : null}
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
