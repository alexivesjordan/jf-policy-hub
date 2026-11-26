import { LandedCostApp } from "@/components/logistics/landed-cost-app";

export const metadata = { title: "Landed cost" };

export default function LandedCostPage() {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-4xl">Landed cost</h1>
      <LandedCostApp />
    </div>
  );
}
