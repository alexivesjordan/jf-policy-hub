import { TextLink } from "@/components/pulse/ui";
import { PageHeader } from "@/components/pulse/page-header";
import { requireSalesUser } from "@/lib/auth";

export const metadata = { title: "Sales" };

export default async function SalesHomePage() {
  await requireSalesUser();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pulse Sales"
        title="Install quoting"
        description="Price an install from a Cin7 order number or a quote PDF. The effort table and pricing settings stay with the install team."
        actions={<TextLink href="/sales/quote">Price a quote</TextLink>}
      />
    </div>
  );
}
