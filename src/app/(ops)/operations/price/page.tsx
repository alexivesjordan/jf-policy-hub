import { PriceQuoteForm } from "@/components/price-quote-form";
import { getOfficeContext } from "@/features/operations/queries";
import { cin7IsConnected } from "@/lib/cin7/client";
import { requireOperationsUser } from "@/lib/auth";

export const metadata = { title: "Price a quote" };

export default async function PricePage() {
  await requireOperationsUser();
  const context = await getOfficeContext();
  const showInternal = context.is_owner || context.ops_role === "install_lead" || context.ops_role === "admin_owner" || context.ops_role === "ops_manager";
  const canPreviewSales = context.is_owner || context.ops_role === "admin_owner" || context.ops_role === "ops_manager";
  const cin7Connected = cin7IsConnected();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-grey">{cin7Connected ? "Mode A · Cin7 Core" : "Mode A · fixture quotes"}</p>
        <h1 className="font-display mt-2 text-4xl">Price a quote</h1>
        <p className="mt-2 max-w-2xl text-ink/70">
          {cin7Connected
            ? "Enter a Cin7 order number, such as SO-00490, or upload a quote PDF. Pricing does not create a job. The PDF parser is unchanged."
            : "Cin7 is not connected, so an order number loads a fixture quote. You can also upload a Cin7 Core quote PDF. Pricing does not create a job."}
        </p>
      </div>
      <PriceQuoteForm cin7Connected={cin7Connected} showInternal={showInternal} canPreviewSales={canPreviewSales} />
    </div>
  );
}
