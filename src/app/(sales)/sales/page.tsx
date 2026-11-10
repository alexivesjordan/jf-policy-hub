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
        description="Price an install and hand it to the office."
        actions={<TextLink href="/sales/quote">Price a quote</TextLink>}
      />
    </div>
  );
}
