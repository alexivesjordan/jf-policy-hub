import { PriceQuoteForm } from "@/components/price-quote-form";
import { PageHeader } from "@/components/pulse/page-header";
import { getOfficeContext } from "@/features/operations/queries";
import { requireSalesUser } from "@/lib/auth";
import { cin7IsConnected } from "@/lib/cin7/client";

export const metadata = { title: "Install quoting" };

export default async function SalesQuotePage() {
  await requireSalesUser();
  const context = await getOfficeContext().catch(() => null);
  const showInternal = Boolean(context && (context.is_owner || context.ops_role === "install_lead" || context.ops_role === "admin_owner" || context.ops_role === "ops_manager"));
  const canPreviewSales = Boolean(context && (context.is_owner || context.ops_role === "admin_owner" || context.ops_role === "ops_manager"));
  const cin7Connected = cin7IsConnected();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={cin7Connected ? "Pulse Sales · Cin7 Core" : "Pulse Sales · fixture quotes"}
        title="Install quoting"
        description={
          cin7Connected
            ? "Enter a Cin7 order number, such as SO-00490, or upload a quote PDF. Create job opens the booking calendar."
            : "Cin7 is not connected, so an order number loads a fixture quote. You can also upload a Cin7 Core quote PDF."
        }
      />
      <PriceQuoteForm cin7Connected={cin7Connected} showInternal={showInternal} canPreviewSales={canPreviewSales} />
    </div>
  );
}
