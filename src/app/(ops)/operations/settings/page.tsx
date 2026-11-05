import { PricingForm, TermsForm } from "@/components/operations-forms";
import { Card } from "@/components/ui";
import { getOfficeContext, readOwnerSettings, readTerms } from "@/features/operations/queries";
import { requireOperationsUser } from "@/lib/auth";

export const metadata = { title: "Pricing" };

export default async function SettingsPage() {
  await requireOperationsUser();
  const context = await getOfficeContext();
  if (!context.is_owner) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-4xl">Pricing</h1>
        <p className="max-w-xl text-white/75">Only the named owner can view and change pricing and the charges grid.</p>
      </div>
    );
  }

  const [pricing, terms] = await Promise.all([readOwnerSettings(), readTerms()]);
  const lines = terms?.charges_grid.lines ?? [];
  const schedule = terms?.cancellation_schedule.rows ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-4xl">Pricing</h1>
        <p className="mt-2 max-w-2xl text-white/70">
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
            <p className="text-white/70">Pricing settings are not configured.</p>
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
