import { requireSalesUser } from "@/lib/auth";
import { PageHeader } from "@/components/pulse/page-header";
import { OpportunityRadarPreview } from "@/components/radar/opportunity-radar-preview";

export const metadata = { title: "Opportunity Radar (pilot)" };

export default async function OpportunityRadarPage() {
  await requireSalesUser();
  return <div className="space-y-6">
    <PageHeader eyebrow="Pulse Sales — pilot" title="Opportunity Radar" />
    <OpportunityRadarPreview />
  </div>;
}
