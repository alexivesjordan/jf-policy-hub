import { connection } from "next/server";
import { requireSalesUser } from "@/lib/auth";
import { CommercialInvoiceWorkspace } from "@/components/logistics/commercial-invoice-workspace";
import { PageHeader } from "@/components/pulse/page-header";

export const metadata = { title: "Commercial invoice generator (preview)" };

export default async function CommercialInvoicesPage() {
  await connection();
  await requireSalesUser();
  return <div className="space-y-6">
    <PageHeader eyebrow="Pulse Logistics — pilot" title="Commercial invoices" />
    <CommercialInvoiceWorkspace />
  </div>;
}
