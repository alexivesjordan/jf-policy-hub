import { ClassificationEditor, ServiceQuoteForm, ServiceRateEditor, type ClassificationRuleRow } from "@/components/service-quote-form";
import { Card } from "@/components/pulse/ui";
import { PageHeader } from "@/components/pulse/page-header";
import { requireSalesUser } from "@/lib/auth";
import { cin7IsConnected } from "@/lib/cin7/client";
import { DEFAULT_SERVICE_RATES } from "@/lib/service-quote/rates";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Warranties and Servicing" };

export default async function ServiceQuotePage() {
  const profile = await requireSalesUser();
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
  const canEdit = profile.workspace_role === "owner" || profile.workspace_role === "admin";

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Pulse Sales"
        title="Warranties and Servicing"
        description="Price proactive maintenance and the five-year parts warranty from an order number or a quote PDF."
      />
      <ServiceQuoteForm cin7Connected={cin7IsConnected()} />
      {canEdit ? (
        <>
          <Card>
            <h2 className="font-display text-2xl">Rate table</h2>
            <p className="mt-2 text-sm text-grey">Version {rates.version}. New quotes use the latest saved card.</p>
            <div className="mt-4"><ServiceRateEditor rates={rates} canEdit={canEdit} /></div>
          </Card>
          <Card>
            <h2 className="font-display text-2xl">SKU and category mapping</h2>
            <p className="mt-2 text-sm text-grey">A matching rule overrides the built-in name check.</p>
            <div className="mt-4"><ClassificationEditor rules={rules} canEdit={canEdit} /></div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
