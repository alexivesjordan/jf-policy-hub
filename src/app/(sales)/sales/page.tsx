import { TextLink } from "@/components/pulse/ui";
import { PageHeader } from "@/components/pulse/page-header";
import { requireSalesUser } from "@/lib/auth";
import { connection } from "next/server";

export const metadata = { title: "Sales" };

export default async function SalesHomePage() {
  await connection();
  await requireSalesUser();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pulse Sales"
        title="Install quoting"
        actions={<TextLink href="/sales/quote">Price a quote</TextLink>}
      />
    </div>
  );
}
