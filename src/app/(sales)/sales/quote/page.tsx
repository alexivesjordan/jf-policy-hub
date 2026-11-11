import { CategoryDefaultEditor } from "@/components/effort-table";
import { PricingForm } from "@/components/operations-forms";
import { PriceQuoteForm } from "@/components/price-quote-form";
import { QuoteSettingsButton } from "@/components/quote-settings-button";
import { PageHeader } from "@/components/pulse/page-header";
import { getOfficeContext, listCin7CategoryDefaults, readOwnerSettings } from "@/features/operations/queries";
import type { PricingSettings } from "@/features/operations/types";
import { canEditQuoteSettings, requireSalesUser } from "@/lib/auth";
import { cin7IsConnected } from "@/lib/cin7/client";
import { seesInstallBreakdown } from "@/lib/pulse/quote-access";

export const metadata = { title: "Install quoting" };

const SEEDED_PRICING: PricingSettings = {
  version: 1,
  markup_independent: 0.4,
  markup_franchisee: 0.4,
  markup_trade: 0.5,
  markup_big_corporate: 0.8,
  min_job_charge: null,
  margin_floor_pct: null,
  custom_deposit_fraction: 1 / 3,
  large_order_threshold: 50000,
  variation_rounding_hours: 0.5,
  sled_track_width_m: null,
  sled_base_minutes: 180,
  sled_base_length_m: 10,
  sled_extra_minutes_per_m: 6,
  change_reason: null,
  created_at: "",
};

export default async function SalesQuotePage() {
  const profile = await requireSalesUser();
  const [context, canEdit, pricing, categories] = await Promise.all([
    getOfficeContext().catch(() => null),
    canEditQuoteSettings(),
    readOwnerSettings().catch(() => null),
    listCin7CategoryDefaults().catch(() => []),
  ]);
  const fullBreakdown = seesInstallBreakdown({
    isOwner: context?.is_owner,
    opsRole: context?.ops_role,
    workspaceRole: profile.workspace_role,
    operations: context?.operations ?? profile.levels?.operations,
  });
  const rates = pricing ?? SEEDED_PRICING;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pulse Sales"
        title="Install quoting"
        actions={
          <QuoteSettingsButton title="Install quoting settings">
            <section className="space-y-3">
              <h2 className="font-display text-xl">Markups and floors</h2>
              <PricingForm
                locked={!canEdit}
                version={Number(rates.version)}
                markups={{
                  independent: Number(rates.markup_independent),
                  franchisee: Number(rates.markup_franchisee),
                  trade: Number(rates.markup_trade),
                  corporate: Number(rates.markup_big_corporate),
                }}
                minJobCharge={rates.min_job_charge == null ? null : Number(rates.min_job_charge)}
                marginFloor={rates.margin_floor_pct == null ? null : Number(rates.margin_floor_pct)}
                depositFraction={Number(rates.custom_deposit_fraction)}
                largeOrderThreshold={Number(rates.large_order_threshold)}
                roundingHours={Number(rates.variation_rounding_hours)}
                sledTrackWidthM={rates.sled_track_width_m == null ? null : Number(rates.sled_track_width_m)}
                sledBaseMinutes={rates.sled_base_minutes == null ? 180 : Number(rates.sled_base_minutes)}
                sledBaseLengthM={rates.sled_base_length_m == null ? 10 : Number(rates.sled_base_length_m)}
                sledExtraMinutesPerMetre={rates.sled_extra_minutes_per_m == null ? 6 : Number(rates.sled_extra_minutes_per_m)}
              />
            </section>
            <section className="space-y-3">
              <h2 className="font-display text-xl">Category effort</h2>
              <p className="text-sm text-grey">Used when a product has not had its own time confirmed.</p>
              {categories.length > 0 ? (
                <CategoryDefaultEditor rows={categories} locked={!canEdit} />
              ) : (
                <p className="text-sm text-grey">No category defaults are saved yet.</p>
              )}
            </section>
          </QuoteSettingsButton>
        }
      />
      <PriceQuoteForm cin7Connected={cin7IsConnected()} fullBreakdown={fullBreakdown} />
    </div>
  );
}
