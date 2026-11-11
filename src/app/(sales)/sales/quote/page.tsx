import { PriceQuoteForm } from "@/components/price-quote-form";
import { PageHeader } from "@/components/pulse/page-header";
import { getOfficeContext } from "@/features/operations/queries";
import { requireSalesUser } from "@/lib/auth";
import { cin7IsConnected } from "@/lib/cin7/client";
import { seesInstallBreakdown } from "@/lib/pulse/quote-access";

export const metadata = { title: "Install quoting" };

export default async function SalesQuotePage() {
  const profile = await requireSalesUser();
  const context = await getOfficeContext().catch(() => null);
  const fullBreakdown = seesInstallBreakdown({
    isOwner: context?.is_owner,
    opsRole: context?.ops_role,
    workspaceRole: profile.workspace_role,
  });
  const cin7Connected = cin7IsConnected();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pulse Sales"
        title="Install quoting"
        description="Enter an order number or upload a quote. Then book the install."
      />
      <PriceQuoteForm cin7Connected={cin7Connected} fullBreakdown={fullBreakdown} />
    </div>
  );
}
