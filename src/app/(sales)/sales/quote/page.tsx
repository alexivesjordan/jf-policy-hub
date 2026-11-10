import { PriceQuoteForm } from "@/components/price-quote-form";
import { PageHeader } from "@/components/pulse/page-header";
import { getOfficeContext } from "@/features/operations/queries";
import { hasLevel } from "@/lib/module-guard";
import { requireSalesUser } from "@/lib/auth";
import { cin7IsConnected } from "@/lib/cin7/client";

export const metadata = { title: "Install quoting" };

export default async function SalesQuotePage() {
  await requireSalesUser();
  const context = await getOfficeContext().catch(() => null);
  const showInternal = Boolean(context && hasLevel(context.operations, "edit", context.is_owner));
  const canPreviewSales = Boolean(context?.is_owner);
  const cin7Connected = cin7IsConnected();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pulse Sales"
        title="Install quoting"
        description="Enter an order number or upload a quote. Then book the install."
      />
      <PriceQuoteForm cin7Connected={cin7Connected} showInternal={showInternal} canPreviewSales={canPreviewSales} />
    </div>
  );
}
