import { CommercialInvoiceWorkspace } from "@/components/logistics/commercial-invoice-workspace";

export const metadata = { title: "Commercial invoices" };

export default function CommercialInvoicesPage() {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-4xl">Commercial invoices</h1>
      <CommercialInvoiceWorkspace />
    </div>
  );
}
