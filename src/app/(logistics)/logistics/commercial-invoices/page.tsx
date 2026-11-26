import { CommercialInvoiceWorkspace } from "@/components/logistics/commercial-invoice-workspace";
import { loadInvoicePrefill } from "@/features/logistics/commercial-invoice/prefill";
import { loadPackPrefill } from "@/features/logistics/packing/queries";

export const metadata = { title: "Commercial invoices" };

export default async function CommercialInvoicesPage({ searchParams }: { searchParams: Promise<{ from?: string; pack?: string }> }) {
  const params = await searchParams;
  const prefill = await loadInvoicePrefill(params.from);
  const pack = prefill ? null : await loadPackPrefill(params.pack);
  return (
    <div className="space-y-4">
      <h1 className="font-display text-4xl">Commercial invoices</h1>
      <CommercialInvoiceWorkspace key={params.from ?? params.pack ?? "new"} prefill={prefill} pack={pack} />
    </div>
  );
}
