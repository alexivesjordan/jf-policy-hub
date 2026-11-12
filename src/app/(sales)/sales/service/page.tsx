import { ClassificationEditor, ServiceQuoteForm, ServiceRateEditor, type ClassificationRuleRow } from "@/components/service-quote-form";
import { QuoteSettingsButton } from "@/components/quote-settings-button";
import { PageHeader } from "@/components/pulse/page-header";
import { canEditQuoteSettings, requireSalesUser } from "@/lib/auth";
import { cin7IsConnected } from "@/lib/cin7/client";
import { DEFAULT_SERVICE_RATES } from "@/lib/service-quote/rates";
import { createClient } from "@/lib/supabase/server";
import { connection } from "next/server";

export const metadata = { title: "Warranties and Servicing" };

export default async function ServiceQuotePage() {
  await connection();
  await requireSalesUser();
  const canEdit = await canEditQuoteSettings();
  const supabase = await createClient();
  const [rateRow, ruleRow] = await Promise.all([
    supabase.rpc("service_current_rates"),
    supabase.rpc("service_list_rules"),
  ]);
  const row = (rateRow.data ?? null) as Record<string, unknown> | null;
  const rates = row
    ? {
        version: String(row.label ?? DEFAULT_SERVICE_RATES.version),
        callout: Number(row.callout_gbp),
        perMachine: Number(row.per_machine_gbp),
        uplift: Number(row.uplift),
        twiceYearlyFactor: Number(row.twice_yearly_factor),
        cardioRate: Number(row.cardio_rate),
        strengthRate: Number(row.strength_rate),
        rackRate: Number(row.rack_rate),
        extensionFactor: Number(row.extension_factor),
        perSite: Number(row.per_site_gbp),
        bundleIncentive: Number(row.bundle_incentive_gbp),
        portfolioFactor: Number(row.portfolio_factor),
      }
    : DEFAULT_SERVICE_RATES;
  const rules = (Array.isArray(ruleRow.data) ? ruleRow.data : []) as ClassificationRuleRow[];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Pulse Sales"
        title="Warranties and Servicing"
        actions={
          <QuoteSettingsButton title="Warranty and servicing settings">
            <section className="space-y-3">
              <h2 className="font-display text-xl">Rate table</h2>
              <p className="text-sm text-grey">Version {rates.version}. New quotes use the latest saved card.</p>
              <ServiceRateEditor rates={rates} canEdit={canEdit} />
            </section>
            <section className="space-y-3">
              <h2 className="font-display text-xl">SKU and category mapping</h2>
              <p className="text-sm text-grey">This is not the list of lines on an order.</p>
              <ClassificationEditor rules={rules} canEdit={canEdit} />
            </section>
          </QuoteSettingsButton>
        }
      />
      <ServiceQuoteForm cin7Connected={cin7IsConnected()} />
    </div>
  );
}
